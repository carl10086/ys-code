# System Prompt 系统设计文档

## 1. 概述

`ys-code` 的 System Prompt 系统采用**组合式构建器模式**，将完整的 system prompt 拆分为多个独立的 Section，通过缓存机制和动静分离策略，实现高效、可维护的 prompt 管理。

### 设计目标

1. **类型安全**：使用 branded type 防止误用
2. **组合优先**：通过 section 组合而非硬编码字符串
3. **性能优化**：静态 section 缓存，动态 section 按需重算
4. **职责分离**：`AgentSession` 管理 prompt 生命周期，`Agent` 纯执行

---

## 2. 核心类型

### `SystemPrompt` (`src/core/ai/types.ts`)

```typescript
export type SystemPrompt = readonly string[] & { readonly __brand: 'SystemPrompt' };

export function asSystemPrompt(value: readonly string[]): SystemPrompt {
  return value as unknown as SystemPrompt;
}
```

使用 branded type 而非直接用 `string[]`，确保类型层面区分"普通字符串数组"和"作为 system prompt 的数组"。

### `SystemPromptContext` (`src/agent/system-prompt/types.ts`)

```typescript
export interface SystemPromptContext {
  /** 当前工作目录 */
  cwd: string;
  /** 可用工具列表 */
  tools: AgentTool<any, any>[];
  /** 当前模型 */
  model: Model<any>;
  /** memory 文件内容（可选） */
  memoryFiles?: string[];
  /** 其他动态状态（可扩展） */
  [key: string]: unknown;
}
```

构建 system prompt 时所需的上下文信息，由调用方提供。

### `SystemPromptSection` (`src/agent/system-prompt/types.ts`)

```typescript
export type SectionCompute = (context: SystemPromptContext) => Promise<string>;

export interface SystemPromptSection {
  /** section 名称 */
  name: string;
  /** 内容计算函数 */
  compute: SectionCompute;
  /** 缓存键生成函数；返回 undefined 表示 dynamic（每轮强制重算） */
  getCacheKey?: (context: SystemPromptContext) => string | undefined;
}
```

---

## 3. 架构设计

### 3.1 构建器模式

`createSystemPromptBuilder` 是核心工厂函数：

```typescript
export function createSystemPromptBuilder(
  sections: SystemPromptSection[],
): (context: SystemPromptContext) => Promise<SystemPrompt>
```

内部维护一个 `Map<string, CacheEntry>` 缓存，遍历 sections 时：
- 有 `getCacheKey` 的 section 尝试从缓存读取
- 无 `getCacheKey` 的 section 判定为 dynamic，每轮强制重算

### 3.2 缓存机制

**静态 sections**：通过 `getCacheKey: () => name` 返回固定键名，实现进程内单次缓存。

**动态 sections**：`getCacheKey` 返回 `undefined`，每次都重新计算。

```typescript
// 静态 section 示例
staticSection("intro", intro.compute)
// 相当于
{ name: "intro", compute: intro.compute, getCacheKey: () => "intro" }

// 动态 section 示例
dynamicSection("using-your-tools", usingYourTools.compute)
// 相当于
{ name: "using-your-tools", compute: usingYourTools.compute }
// getCacheKey 为 undefined
```

### 3.3 动静分离边界

`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 标记用于分隔静态和动态 sections：

```typescript
// 静态 sections 结果
[section1, section2, ...]
// 分隔符
"\n\n=== DYNAMIC SYSTEM PROMPT SECTIONS ===\n\n"
// 动态 sections 结果
[dynamicSection1, dynamicSection2, ...]
```

这样 LLM 可以感知哪些内容是静态的（可缓存）、哪些是动态的（每轮变化）。

---

## 4. Section 详解

### 4.1 Intro（静态）

身份声明，定义 Agent 的核心定位：

```
You are an interactive agent that helps users with software engineering tasks.
```

### 4.2 System（静态）

系统行为约束，包含关键运行时机制说明：

- Tool 执行权限模型（用户授权模式）
- `<system-reminder>` 标签说明
- Prompt injection 安全提示
- 上下文自动压缩机制

### 4.3 Doing Tasks（静态）

任务执行原则，定义软件工程任务的核心指导思想：

- 先读代码再改
- YAGNI 原则
- 不创建 speculative abstractions
- 安全边界（OWASP top 10）

### 4.4 Actions（静态）

执行动作时的谨慎原则，明确何时需要用户确认：

- 可逆 vs 难以逆转的操作
- 破坏性操作（删除、force-push 等）
- 影响共享状态的操作
- 不可用 destructive actions 作为 shortcut

### 4.5 Using Your Tools（动态）

基于当前工具列表生成的工具使用规范。**无工具时返回空字符串，有工具时生成详细规范**：

- 优先使用专用工具而非 Bash
- 并行调用工具的条件
- 工具调用格式要求

### 4.6 Env Info（动态）

环境信息，随 context 变化：

```typescript
[
  "# Environment",
  `  - Primary working directory: ${cwd}`,
  `  - Current model: ${model.id}`,
]
```

### 4.7 Output Efficiency（静态）

输出效率要求，强调简洁直接：

- Go straight to the point
- 优先一句话说清
- 跳过 filler words 和 preamble
- 只在必要时解释

### 4.8 Tone and Style（静态）

语气风格规范：

- 非用户请求不用 emoji
- 响应简短精炼
- 引用代码使用 `file_path:line_number` 格式
- GitHub issue 使用 `owner/repo#123` 格式

### 4.9 Summarize Tool Results（静态）

工具结果记忆提示：

```
When working with tool results, write down any important information you might need later in your response, as the original tool result may be cleared later.
```

### 4.10 Session Specific Guidance（静态）

预留扩展接口，当前返回空字符串。

### 4.11 Memory（动态）

可选的 memory 文件内容注入：

```typescript
if (!context.memoryFiles || context.memoryFiles.length === 0) {
  return "";
}
return ["Memory content:", ...context.memoryFiles].join("\n");
```

---

## 5. 使用方式

### 5.1 AgentSession 中的使用

`AgentSession` 是主要的入口点，在每次 `prompt()` 前自动刷新 system prompt：

```typescript
// src/agent/session.ts

class AgentSession {
  private readonly systemPromptBuilder: (context: SystemPromptContext) => Promise<SystemPrompt>;

  constructor(options: AgentSessionOptions) {
    // ...
    this.systemPromptBuilder = options.systemPrompt ?? buildCodingAgentSystemPrompt;
  }

  async prompt(text: string): Promise<void> {
    await this.refreshSystemPrompt();  // 每次 prompt 前刷新
    await this.agent.prompt(text);
  }

  private async refreshSystemPrompt(): Promise<void> {
    const context: SystemPromptContext = {
      cwd: this.cwd,
      tools: this.agent.state.tools,
      model: this.agent.state.model,
    };
    const prompt = await this.systemPromptBuilder(context);
    this.agent.systemPrompt = async () => prompt;
  }
}
```

### 5.2 自定义 System Prompt

通过 `AgentSessionOptions.systemPrompt` 注入自定义构建器：

```typescript
const session = new AgentSession({
  cwd: process.cwd(),
  model,
  apiKey,
  systemPrompt: async (context) => {
    // 自定义逻辑
    return asSystemPrompt([
      "You are a specialized code reviewer.",
      `Analyzing: ${context.cwd}`,
    ]);
  },
});
```

### 5.3 Coding Agent 默认构建

`buildCodingAgentSystemPrompt` 组合所有 sections：

```typescript
// src/agent/system-prompt/coding-agent.ts

const sections: SystemPromptSection[] = [
  staticSection("intro", intro.compute),
  staticSection("system", system.compute),
  staticSection("doing-tasks", doingTasks.compute),
  staticSection("actions", actions.compute),
  dynamicSection("using-your-tools", usingYourTools.compute),
  dynamicSection("env-info", envInfo.compute),
  staticSection("output-efficiency", outputEfficiency.compute),
  staticSection("tone-and-style", toneAndStyle.compute),
  staticSection("summarize-tool-results", summarizeToolResults.compute),
  staticSection("session-specific-guidance", sessionSpecificGuidance.compute),
];

export function buildCodingAgentSystemPrompt(
  context: SystemPromptContext,
): Promise<SystemPrompt> {
  return createSystemPromptBuilder(sections)(context);
}
```

---

## 6. 数据流图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AgentSession.prompt()                        │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    refreshSystemPrompt()                            │
│  context = { cwd, tools, model }                                   │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│              buildCodingAgentSystemPrompt(context)                  │
│                                                                       │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ createSystemPromptBuilder(sections)                         │    │
│  │                                                              │    │
│  │  for section in sections:                                    │    │
│  │    if hasCacheKey(section):                                  │    │
│  │      if cacheHit: reuse                                     │    │
│  │      else: compute + cache                                   │    │
│  │    else:  // dynamic                                        │    │
│  │      compute every turn                                      │    │
│  │                                                              │    │
│  │  merge: [static...] + BOUNDARY + [dynamic...]               │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│         this.agent.systemPrompt = async () => prompt               │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Agent.createLoopConfig()                       │
│  resolvedPrompt = await this.systemPrompt(context)                  │
│  config.systemPrompt = resolvedPrompt                              │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Anthropic Provider                              │
│  params.system = buildSystemBlocks(context.systemPrompt)            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. 关键设计决策

### 7.1 为什么用 branded type？

防止将普通 `string[]` 误传给需要 `SystemPrompt` 的位置。TypeScript 的 structural typing 会让 `string[]` 和 `readonly string[]` 双向兼容，用 branded type 可以在编译期捕获这类错误。

### 7.2 为什么动静分离？

静态内容可以缓存在 LLM 的 context window 边界，减少每轮 token 消耗。动态内容（如工具列表、环境信息）每轮必须更新，分隔标记让 LLM 清楚知道哪些内容可能过期。

### 7.3 为什么 Agent 和 AgentSession 分层？

`Agent` 保持通用和简单，只负责"执行"；`AgentSession` 负责"管理"，包括 system prompt 的生命周期、事件转发等。这样 `Agent` 可以独立测试和使用。

### 7.4 为什么用 `async () => asSystemPrompt([""])` 作为默认值？

避免 `systemPrompt` 为 `undefined` 时崩溃，同时提供一个最小化的空 prompt。当 `AgentSession` 接管后，会立即用真实 prompt 替换。
