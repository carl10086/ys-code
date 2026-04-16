# System Prompt 架构设计

## 设计目标

为 ys-code 的 `Agent` 引入与 Claude Code 对齐的 `string[]` 结构 system prompt，支持：

1. **静态 section 缓存**：不随 turn 变化的 section 只计算一次，降低 CPU 和 IO 开销。
2. **动态 section 实时更新**：依赖 `cwd`、git、memory 等易变状态的 section 每轮重算。
3. **Anthropic prompt caching**：静态 sections 集中放在数组前部并打 `cache_control`， Anthropic API 只需写入一次缓存，后续读取即可。
4. **结构可扩展**：新增 section 时不改动 `Agent` 核心逻辑，只在 `system-prompt/sections/` 下新增文件。

## 目录结构

```
src/agent/
  system-prompt/
    systemPrompt.ts          # 入口：调度 section 计算、管理缓存、返回 string[]
    types.ts                 # SystemPromptContext、Section 抽象类型
    sections/
      intro.ts
      system.ts
      doing-tasks.ts
      actions.ts
      using-your-tools.ts
      tone-and-style.ts
      output-efficiency.ts
      session-specific-guidance.ts
      memory.ts
      env-info.ts
      summarize-tool-results.ts
```

## Section 清单

共 **11 个 section**，按 cc 的 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 划分为静态 7 个 + 动态 4 个。

| 序号 | 名称 | 类型 | 核心职责 | MVP 内容策略 |
|------|------|------|----------|--------------|
| 1 | `intro` | static | 身份声明："你是一个 AI 编程助手" | 固定文本 |
| 2 | `system` | static | 运行环境说明（Bun/TypeScript/OpenTUI 等） | 固定文本 |
| 3 | `doing_tasks` | static | 核心任务处理原则：先读再改、目标驱动 | 固定文本 |
| 4 | `actions` | static | 允许执行的操作类型与边界 | 固定文本 |
| 5 | `using_your_tools` | static | 当前可用工具列表及使用规范 | 依赖 `tools` 列表，tools hash 作为 cacheKey |
| 6 | `tone_and_style` | static | 输出风格约束（中文、简洁、不道歉） | 固定文本 |
| 7 | `output_efficiency` | static | 避免冗余总结、只改必要代码 | 固定文本 |
| 8 | `session_specific_guidance` | dynamic | 针对当前会话上下文的临时引导 | MVP 可返回 `""` |
| 9 | `memory` | dynamic | 从 memory 文件读取的持久化记忆 | MVP 可返回 `""` |
| 10 | `env_info` | dynamic | 当前 `cwd`、shell、git 分支等 | 每轮实时计算 |
| 11 | `summarize_tool_results` | dynamic | 长 tool result 的摘要策略 | MVP 可返回固定模板或 `""` |

> **空字符串占位约定**：MVP 阶段没有内容的 dynamic section 返回 `""`，但保留在 `string[]` 中。这样数组长度和 section 顺序稳定，便于调试和问题定位。

## 核心类型定义

```ts
// src/agent/system-prompt/types.ts

/** 构建 system prompt 所需的上下文 */
export interface SystemPromptContext {
  /** 当前工作目录 */
  cwd: string;
  /** 可用工具列表 */
  tools: AgentTool<any>[];
  /** 当前模型 */
  model: Model<any>;
  /** memory 文件内容（可选） */
  memoryFiles?: string[];
  /** 其他动态状态（可扩展） */
  [key: string]: unknown;
}

/** Section 计算函数 */
export type SectionCompute = (context: SystemPromptContext) => Promise<string>;

/** Section 定义 */
export interface SystemPromptSection {
  /** section 名称 */
  name: string;
  /** 内容计算函数 */
  compute: SectionCompute;
  /** 缓存键生成函数；返回 undefined 表示 dangerous（每轮强制重算） */
  getCacheKey?: (context: SystemPromptContext) => string | undefined;
}

/** 数组中用于分隔 static 与 dynamic sections 的边界标记 */
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "\n\n=== DYNAMIC SYSTEM PROMPT SECTIONS ===\n\n";
```

## 缓存策略

`systemPrompt.ts` 内部维护一个 `Map<string, { cacheKey: string; value: string }>`：

1. **static section**：`getCacheKey` 返回稳定字符串（如 `"intro-v1"` 或 tools hash）。若 `cacheKey` 与缓存中一致，直接复用上次结果。
2. **dynamic section**：`getCacheKey` 返回 `undefined`（或不提供该字段），表示 `dangerous`，每轮强制调用 `compute`。
3. **缓存生命周期**：与 `Agent` 实例生命周期一致。`Agent.reset()` 时同步清空 system prompt 缓存。

```ts
// 伪代码
async function resolveSections(
  sections: SystemPromptSection[],
  context: SystemPromptContext,
  cache: Map<string, { cacheKey: string; value: string }>,
): Promise<string[]> {
  const staticValues = await Promise.all(
    sections.filter((s) => s.getCacheKey).map(async (section) => {
      const cacheKey = section.getCacheKey!(context);
      const hit = cache.get(section.name);
      if (hit && hit.cacheKey === cacheKey) return hit.value;
      const value = await section.compute(context);
      cache.set(section.name, { cacheKey, value });
      return value;
    }),
  );

  const dynamicValues = await Promise.all(
    sections.filter((s) => !s.getCacheKey).map((section) => section.compute(context)),
  );

  return [...staticValues, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, ...dynamicValues];
}
```

## 数据流

```
Agent.runWithLifecycle()
  └─ createLoopConfig()
       └─ buildSystemPrompt(agentContext)
            ├─ static sections → 命中 cacheKey 则直接取缓存
            ├─ dynamic sections → 每轮强制 compute
            └─ 返回 string[] (长度 11，空字符串占位)
                 └─ stream-assistant.ts 组装 Context
                      └─ Anthropic provider
                           ├─ static sections → 合并为一个/多个带 cache_control 的 text block
                           ├─ dynamic sections → 普通 text block（不打 cache_control）
                           └─ 空字符串 block → provider 层过滤掉，不发送到 API
```

### 关于 Anthropic cache_control 的分配

Anthropic 的 `system` 字段支持多个 `text` block，每个 block 可独立带 `cache_control`。

`string[]` 中会插入一个显式的 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 元素作为分隔。Provider 层据此切分：
- **boundary 之前**：static sections，拼接为**一个** `text` block，末尾打 `cache_control: { type: "ephemeral" }`。
- **boundary 之后**：dynamic sections，拼接为**一个** `text` block，不打 `cache_control`。

```ts
function buildSystemBlocks(sections: string[], cacheControl?: object) {
  const boundaryIndex = sections.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
  const staticSections = boundaryIndex >= 0 ? sections.slice(0, boundaryIndex) : sections;
  const dynamicSections = boundaryIndex >= 0 ? sections.slice(boundaryIndex + 1) : [];

  const blocks: Anthropic.Messages.TextBlockParam[] = [];
  const staticText = staticSections.filter((s) => s.trim().length > 0).join("\n\n");
  const dynamicText = dynamicSections.filter((s) => s.trim().length > 0).join("\n\n");

  if (staticText) {
    blocks.push({ type: "text", text: staticText, ...(cacheControl ? { cache_control: cacheControl } : {}) });
  }
  if (dynamicText) {
    blocks.push({ type: "text", text: dynamicText });
  }
  return blocks;
}
```

> 未来如果 static sections 很长，可以进一步拆分为多个 block 并在最后一个 static block 上打 cache_control，但 MVP 阶段一个 static block 足够。

## 与现有 Agent 的集成方式

### 1. Agent 层：挂载 `buildSystemPrompt`

`Agent` 构造函数新增一个可选的 `buildSystemPrompt` 字段（或复用 `convertToLlm` 旁边的设计）：

```ts
export interface AgentOptions {
  // ... 现有字段
  buildSystemPrompt?: (context: AgentContext) => Promise<string[]>;
}
```

若未提供，则 fallback 到现有的 `options.initialState.systemPrompt` 行为（兼容旧逻辑）。

### 2. createLoopConfig 注入 systemPrompt

`createLoopConfig` 需要从同步方法改为 `async`：

```ts
private async createLoopConfig(...): Promise<AgentLoopConfig> {
  return {
    // ...
    systemPrompt: this.buildSystemPrompt
      ? await this.buildSystemPrompt(this.createContextSnapshot())
      : [this._state.systemPrompt ?? ""].filter(Boolean),
    // ...
  };
}
```

### 3. 类型扩展

`AgentLoopConfig` 和 `Context`（`src/core/ai/types.ts`）的 `systemPrompt` 字段都需要从 `string` 扩展为 `string | string[]`：

```ts
// src/agent/types.ts
export interface AgentLoopConfig extends SimpleStreamOptions {
  // ...
  systemPrompt?: string | string[];
  // ...
}

// src/core/ai/types.ts
export interface Context {
  systemPrompt?: string | string[];
  messages: Message[];
  tools?: Tool[];
}
```

### 4. Provider 层适配

以 Anthropic provider 为例，`buildParams` 中处理 `systemPrompt` 的逻辑改为：

```ts
if (context.systemPrompt) {
  const sections = Array.isArray(context.systemPrompt)
    ? context.systemPrompt
    : [context.systemPrompt];
  
  // 过滤空字符串
  const nonEmpty = sections.filter((s) => s.trim().length > 0);
  
  // 按 static/dynamic 边界分组（MVP：前半段 static，后半段 dynamic）
  params.system = buildSystemBlocks(nonEmpty, cacheControl);
}
```

其他 provider（如 minimax）若无多 block system 支持，可直接 `join("\n\n")` 兼容。

## 空字符串处理约定

1. **section 层**：允许返回 `""`，表示"本 section 在当前 context 下无内容"。
2. **systemPrompt.ts 层**：不过滤空字符串，保证 `string[]` 长度和 section 顺序稳定。
3. **provider 层**：在构建 API payload 时过滤掉纯空的 block，避免向 LLM 发送无意义内容。

这一约定兼顾了"调试可见性"和"API 效率"。

## 错误处理

- `section.compute()` 抛出异常时，`systemPrompt.ts` 将其捕获并返回 `""`，同时打印 warning。不允许单个 section 的失败导致整个 turn 失败。
- 若所有 section 均返回 `""`，`Agent` 应跳过 `systemPrompt` 字段的传入（保持与当前行为兼容）。
