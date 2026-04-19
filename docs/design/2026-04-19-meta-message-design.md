# Meta Message 系统设计文档

## 1. 概述

`ys-code` 的 Meta Message 机制复刻了 claude-code 的 CLAUDE.md 发现、解析与注入逻辑。CLAUDE.md 等规则文件**不进入 system prompt**，而是作为 `<system-reminder>` 包裹的 **meta user message**，在每次 API 调用前插入 `messages` 数组最前端。该 meta 消息**不写入持久化历史**，仅存活于单次请求。

### 设计目标

1. **零侵入 provider**：meta 消息对 provider 层完全透明，只是普通 UserMessage
2. **单次存活**：meta 消息只存在于当次 API 调用，不进入 context.messages 历史
3. **完整兼容**：支持 @include 递归、frontmatter paths 过滤、HTML 注释 stripping
4. **可控开关**：通过 `disableUserContext` 可禁用自动注入

### 核心模块

| 模块 | 职责 |
|---|---|
| `src/utils/claudemd.ts` | 规则文件发现、解析、格式化 |
| `src/agent/context/user-context.ts` | 组装 UserContext 与 prepend 逻辑 |
| `stream-assistant.ts` | 集成点，调用 prependUserContext |

---

## 2. 核心类型

### `MemoryFileInfo` (`src/utils/claudemd.ts`)

```typescript
/** 规则文件信息 */
export interface MemoryFileInfo {
  /** 展示路径 */
  path: string;
  /** 磁盘真实路径 */
  fullPath: string;
  /** 处理后的内容 */
  content: string;
  /** 可选描述 */
  description?: string;
  /** 来源标识 */
  source: string;
}
```

### `MemoryFilePriority` (`src/utils/claudemd.ts`)

```typescript
/** 规则文件优先级（数值越小越靠前） */
export enum MemoryFilePriority {
  MANAGED = 0,
  USER = 1,
  PROJECT = 2,
  LOCAL = 3,
  AUTO_MEM = 4,
  TEAM_MEM = 5,
}
```

### `UserContext` (`src/agent/context/user-context.ts`)

```typescript
/** 用户上下文 */
export interface UserContext {
  /** CLAUDE.md 聚合内容 */
  claudeMd?: string;
  /** 当前日期 */
  currentDate?: string;
}
```

---

## 3. 架构与数据流

```
磁盘文件系统
    │
    ▼
[src/utils/claudemd.ts]
    ├── 向上遍历目录发现规则文件
    ├── 解析 frontmatter (paths 条件过滤)
    ├── 处理 @include 递归包含
    ├── strip HTML block comments
    └── 返回 MemoryFileInfo[]
    │
    ▼
[src/agent/context/user-context.ts]
    ├── 调用 getMemoryFiles() (memoized)
    ├── 过滤注入文件
    ├── 格式化 getClaudeMds() → 字符串
    ├── 附加 currentDate 等上下文
    └── 返回 UserContext
    │
    ▼
[stream-assistant.ts transformContext]
    └── prependUserContext(messages, userContext)
        └── 生成 UserMessage(<system-reminder>...)
        └── 插入 messages 数组开头
    │
    ▼
provider API (无感知，meta 就是普通 UserMessage)
    │
    ▼
局部 messages（含 meta）仅用于当次请求
不写入 context.messages 持久化历史
```

**关键原则：**
- `claudemd.ts` 是纯工具模块，只负责发现、读取、格式化文件
- `user-context.ts` 是连接层，负责 memoization 和组装
- `stream-assistant.ts` 是注入点，保证 meta 消息只存活于单次 API 调用
- **provider 层完全无感知**，meta 就是普通 `UserMessage`

---

## 4. claudemd.ts 详解

### 4.1 文件发现规则

从根目录向 `cwd` 遍历，每个目录层级收集：

| 文件 | 来源标识 |
|---|---|
| `CLAUDE.md` | project |
| `.claude/CLAUDE.md` | project |
| `.claude/rules/*.md` | project |
| `CLAUDE.local.md` | local |

同时读取用户主目录 `~/.claude/` 下的全局规则（user 优先级）。

**去重逻辑**：同一 `fullPath` 只保留一次；高优先级（更靠近 `cwd`）覆盖低优先级。

### 4.2 @include 机制

- **语法**：`@path/to/file.md`、`@./relative.md`、`@~/home.md`、`@/absolute.md`
- **循环检测**：记录已 include 路径链，遇循环立即终止
- **深度限制**：默认 `maxDepth = 10`
- **解析位置**：include 内容直接内联到当前位置
- **展示策略**：`getClaudeMds` 只展示宿主文件路径，被 include 文件不单独出现

```typescript
const includeRegex = /^@([~.\/][^\s]+)$/gm;
```

### 4.3 paths 条件过滤

- 读取 YAML frontmatter
- 若存在 `paths: ["src/**/*.ts"]`，仅在 `cwd` 匹配 glob 时生效
- 不匹配则 `processMemoryFile` 返回 `null`

```typescript
if (frontmatter?.paths) {
  const patterns = Array.isArray(frontmatter.paths) ? frontmatter.paths : [frontmatter.paths];
  const matches = patterns.some((pattern: string) => {
    return picomatch(pattern, { contains: true, dot: true })(cwd);
  });
  if (!matches) {
    return null;
  }
}
```

### 4.4 HTML 注释 stripping

- 使用 `marked` lexer 解析 markdown
- 过滤 `type === 'html'` 且为块级注释的 token

```typescript
function stripHtmlBlockComments(content: string): string {
  try {
    const tokens = marked.lexer(content);
    const filtered = tokens.filter((token: any) => {
      if (token.type === "html") {
        const raw = token.raw?.trim() || "";
        return !/^<!--[\s\S]*?-->$/m.test(raw);
      }
      return true;
    });
    return filtered.map((token: any) => token.raw || "").join("");
  } catch {
    return content;
  }
}
```

### 4.5 格式化输出

`getClaudeMds` 将 MemoryFileInfo 数组格式化为 claudeMd 字符串：

```
The following additional context was automatically retrieved. It may or may not be relevant to the user's request. You should use it if it is, and ignore it if it is not.

Contents of path/to/file.md:
<file content>

Contents of another.md:
<file content>
```

---

## 5. user-context.ts 详解

### 5.1 缓存机制

`getUserContext` 和 `getMemoryFiles` 都使用 memoization 缓存，按 `cwd` 索引避免重复 I/O。

```typescript
const userContextCache = new Map<string, Promise<UserContext>>();
const memoryFilesCache = new Map<string, Promise<MemoryFileInfo[]>>();
```

### 5.2 prependUserContext

将 `UserContext` 转换为 `<system-reminder>` 包裹的 `UserMessage`，插入 messages 数组最前面：

```typescript
export function prependUserContext(messages: Message[], context: UserContext): Message[] {
  const entries = Object.entries(context).filter(([, value]) => value && value.trim() !== "");
  if (entries.length === 0) return messages;

  const content = [
    "<system-reminder>",
    "As you answer the user's questions, you can use the following context:",
    ...entries.map(([key, value]) => `# ${key}\n${value}`),
    "",
    "IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.",
    "</system-reminder>",
    "",
  ].join("\n");

  const metaMessage: UserMessage = {
    role: "user",
    content,
    timestamp: Date.now(),
  };

  return [metaMessage, ...messages];
}
```

### 5.3 输出格式示例

```
<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
The following additional context was automatically retrieved. It may or may not be relevant to the user's request. You should use it if it is, and ignore it if it is not.

Contents of CLAUDE.md:
<content>

Contents of .claude/rules/code.md:
<content>

# currentDate
2026/04/19

IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
```

---

## 6. 集成与配置

### 6.1 AgentLoopConfig

在 `AgentLoopConfig` 中增加可选字段：

```typescript
export interface AgentLoopConfig extends SimpleStreamOptions {
  // ... 现有字段
  /** 禁用自动 userContext prepend */
  disableUserContext?: boolean;
}
```

### 6.2 stream-assistant.ts 集成

```typescript
let messages = context.messages;
if (config.transformContext) {
  messages = await config.transformContext(messages, signal);
} else if (!config.disableUserContext) {
  const userContext = await getUserContext({ cwd: process.cwd() });
  messages = prependUserContext(messages as Message[], userContext) as typeof messages;
}
```

**优先级**：
1. 若提供 `transformContext`，使用它
2. 否则若 `disableUserContext !== true`，使用默认 prependUserContext
3. 否则保持原 messages 不变

### 6.3 与 system prompt 的关系

当前 `src/agent/system-prompt/types.ts` 已有 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`，用于 **system 通道**的缓存分层。

本次设计的 CLAUDE.md + meta message 走 **messages 通道**，两者互不干扰：
- **system 侧**：静态段 + `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` + 动态段
- **messages 侧**：每次 API 调用前插入 `<system-reminder>` user 消息

无需改动 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 的任何逻辑。

---

## 7. 错误处理

| 场景 | 处理策略 |
|---|---|
| `cwd` 下无规则文件 | `getClaudeMds` 返回 `null`，`prependUserContext` 跳过该键 |
| `@include` 指向不存在文件 | 跳过该 include，位置留空 |
| `@include` 循环依赖 | 检测到循环即终止递归 |
| `paths` 不匹配 | 过滤掉整个文件 |
| HTML comment stripping 失败 | fallback 为原始内容 |
| 读取文件权限不足 | 跳过该文件，不阻断流程 |

---

## 8. 文件结构

```
src/
  utils/
    claudemd.ts              # 规则文件发现、解析、格式化
    claudemd.test.ts         # 单元测试
  agent/
    context/
      user-context.ts        # UserContext 组装与 prepend
      user-context.test.ts   # 单元测试
    stream-assistant.ts       # 集成默认 transformContext fallback
    types.ts                  # AgentLoopConfig.disableUserContext
```
