# CLAUDE.md + MetaMessage 机制设计

## 目标

在 ys-code 中完整复刻 claude-code（cc）的 CLAUDE.md 发现、解析与注入机制：
- CLAUDE.md 等内容**不进入 system prompt**，而是作为 `<system-reminder>` 包裹的 **meta user message**，在每次 API 调用前插入 `messages` 最前端。
- 该 meta 消息**不写入持久化历史**（`context.messages`），仅存活于单次请求。
- 支持 `@include` 递归包含、frontmatter `paths` 条件过滤、HTML block comment stripping。

---

## 一、整体架构与数据流

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
[AgentLoopConfig.transformContext]
    └── prependUserContext(messages, userContext)
        └── 生成 UserMessage(<system-reminder>...)
        └── 插入 messages 数组开头
    │
    ▼
[stream-assistant.ts] → [convertToLlm] → provider API
         │
         ▼
    局部 messages（含 meta）仅用于当次请求
    不写入 context.messages 持久化历史
```

**关键原则：**
- `claudemd.ts` 是纯工具模块，只负责发现、读取、格式化文件。
- `user-context.ts` 是连接层，负责 memoization 和组装。
- `transformContext` 是注入点，保证 meta 消息只存活于单次 API 调用。
- **provider 层完全无感知**，meta 就是普通 `UserMessage`。

---

## 二、`src/utils/claudemd.ts` 模块

### 2.1 数据结构

```ts
/** 规则文件优先级（数值越小越靠前） */
export enum MemoryFilePriority {
  MANAGED = 0,
  USER = 1,
  PROJECT = 2,
  LOCAL = 3,
  AUTO_MEM = 4,
  TEAM_MEM = 5,
}

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

### 2.2 核心函数

```ts
/** 获取当前 CWD 下所有生效的 memory 文件（memoized） */
export declare const getMemoryFiles: (cwd?: string) => Promise<MemoryFileInfo[]>;

/** 处理单条 memory 文件 */
export function processMemoryFile(
  filePath: string,
  source: string,
  options?: { maxDepth?: number }
): Promise<MemoryFileInfo | null>;

/** 过滤已被注入的文件 */
export function filterInjectedMemoryFiles(
  files: MemoryFileInfo[],
  injectedPaths?: Set<string>
): MemoryFileInfo[];

/** 将 memory 文件列表格式化为 claudeMd 字符串 */
export function getClaudeMds(files: MemoryFileInfo[]): string | null;
```

### 2.3 文件发现规则（按优先级从低到高）

从根目录向 `cwd` 遍历，每个目录层级收集：
1. `CLAUDE.md`
2. `.claude/CLAUDE.md`
3. `.claude/rules/*.md`
4. `CLAUDE.local.md`

同时读取用户主目录下的 `.claude/CLAUDE.md` 等全局规则（`USER` 优先级）。

**去重逻辑**：同一 `fullPath` 只保留一次；高优先级（更靠近 `cwd`）覆盖低优先级。

### 2.4 `@include` 机制

- 语法：`@path/to/file.md`、`@./relative.md`、`@~/home.md`、`@/absolute.md`
- **循环检测**：记录已 include 路径链，遇循环立即终止
- **深度限制**：默认 `maxDepth = 10`
- **解析位置**：include 内容直接内联到当前位置
- **展示策略**：`getClaudeMds` 只展示宿主文件路径，被 include 文件不单独出现

### 2.5 `paths` 条件过滤（`.claude/rules/*.md`）

- 读取 YAML frontmatter
- 若存在 `paths: ["src/**/*.ts"]`，仅在 `cwd` 匹配 glob 时生效
- 不匹配则 `processMemoryFile` 返回 `null`

### 2.6 HTML comment stripping

- 使用 `marked` lexer 解析 markdown
- 过滤 `type === 'html'` 且为块级注释的 token
- 失败时 fallback 为原始内容

---

## 三、`src/agent/context/user-context.ts` 模块

### 3.1 数据结构

```ts
export interface UserContext {
  claudeMd?: string;
  currentDate?: string;
}
```

### 3.2 核心函数

```ts
/** memoized 组装 userContext */
export declare const getUserContext: (options?: {
  cwd?: string;
  currentDate?: string;
  disableClaudeMd?: boolean;
}) => Promise<UserContext>;

/** 将 userContext 注入 messages 最前面 */
export function prependUserContext(
  messages: Message[],
  context: UserContext,
): Message[];
```

### 3.3 输出格式

生成的 `UserMessage` 内容格式与 cc 保持一致：

```
<system-reminder>
As you answer the user's questions, you can use the following context:
# claudeMd
<getClaudeMds 结果>

# currentDate
2026/04/17

IMPORTANT: this context may or may not be relevant to your tasks. You should not respond to this context unless it is highly relevant to your task.
</system-reminder>
```

---

## 四、与 `AgentLoopConfig` 的集成

### 4.1 默认内置注入

在 `src/agent/stream-assistant.ts` 中增加默认 fallback：

```ts
let messages = context.messages;
if (config.transformContext) {
  messages = await config.transformContext(messages, signal);
} else {
  const { getUserContext, prependUserContext } = await import("./context/user-context.js");
  const userContext = await getUserContext({ cwd: process.cwd() });
  messages = prependUserContext(messages as Message[], userContext) as AgentMessage[];
}
```

### 4.2 禁用开关

在 `AgentLoopConfig` 中增加可选字段：

```ts
export interface AgentLoopConfig extends SimpleStreamOptions {
  // ... 现有字段
  /** 禁用自动 userContext prepend */
  disableUserContext?: boolean;
}
```

当 `disableUserContext === true` 时跳过默认注入。

---

## 五、错误处理与边界情况

| 场景 | 处理策略 |
|---|---|
| `cwd` 下无规则文件 | `getClaudeMds` 返回 `null`，`prependUserContext` 跳过该键 |
| `@include` 指向不存在文件 | 跳过该 include，位置留空 |
| `@include` 循环依赖 | 检测到循环即终止递归 |
| `paths` 不匹配 | 过滤掉整个文件 |
| HTML comment stripping 失败 | fallback 为原始内容 |
| 读取文件权限不足 | 跳过该文件，不阻断流程 |

---

## 六、文件与目录规划

```
src/
  utils/
    claudemd.ts
  agent/
    context/
      user-context.ts
    stream-assistant.ts   (修改：增加默认 transformContext fallback)
    types.ts              (修改：增加 disableUserContext 字段)
```

---

## 七、与现有 system prompt 的关系

当前 `src/agent/system-prompt/types.ts` 已有 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY`，用于 **system 通道**的缓存分层。

本次设计的 CLAUDE.md + meta message 走 **messages 通道**，两者互不干扰：
- **system 侧**：静态段 + `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` + 动态段
- **messages 侧**：每次 API 调用前插入 `<system-reminder>` user 消息

无需改动 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 的任何逻辑。
