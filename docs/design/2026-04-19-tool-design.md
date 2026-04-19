# Tool 系统设计文档

## 1. 概述

`ys-code` 的 Tool 系统采用**垂直切片化设计**：每个 Tool 自己负责参数校验、权限判断、执行、结果格式化，同时支持基于上下文的动态描述。与 `claude-code-haha` 的 Tool 设计对标，实现完整生命周期管理。

### 设计目标

1. **自包含**：每个 Tool 内聚参数校验、权限检查、执行、结果格式化
2. **类型安全**：使用 TypeBox schema 定义输入输出
3. **可观测**：通过 AgentEvent 发出 tool_execution_start/update/end 事件
4. **可组合**：通过 defineAgentTool 辅助函数统一默认值
5. **零耦合**：不与 TUI/Ink/OpenTUI 耦合，纯业务逻辑

### 核心模块

| 模块 | 职责 |
|---|---|
| `src/agent/types.ts` | AgentTool 接口定义 |
| `src/agent/define-agent-tool.ts` | 工厂函数，提供安全默认值 |
| `src/agent/tool-execution.ts` | 标准化执行流水线 |
| `src/agent/tools/` | 具体 Tool 实现（Bash、Read、Write、Edit） |

---

## 2. 核心类型

### `AgentTool` (`src/agent/types.ts`)

```typescript
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TOutput = unknown,
> {
  /** 工具名称 */
  name: string;

  /**
   * 工具描述。
   * - 若为 string，则作为静态描述直接使用
   * - 若为函数，则根据输入参数和上下文动态生成最终描述
   */
  description:
    | string
    | ((params: Static<TParameters>, context: ToolUseContext) => string | Promise<string>);

  /** 输入参数 schema（TypeBox） */
  parameters: TSchema;

  /** 结构化输出 schema（TypeBox） */
  outputSchema: TSchema;

  /** 显示标签 */
  label: string;

  /** 参数预处理：将 LLM 原始参数转换为符合 schema 的输入 */
  prepareArguments?: (args: unknown) => Static<TParameters>;

  /**
   * 参数校验（在权限检查前调用）。
   * 用于执行 Tool 级别的参数合法性验证。
   */
  validateInput?: (
    params: Static<TParameters>,
    context: ToolUseContext,
  ) => Promise<{ ok: true } | { ok: false; message: string; errorCode?: number }>;

  /**
   * 权限检查（在 validateInput 通过后调用）。
   * 用于执行 Tool 级别的权限决策。
   */
  checkPermissions?: (
    params: Static<TParameters>,
    context: ToolUseContext,
  ) => Promise<{ allowed: true } | { allowed: false; reason: string }>;

  /**
   * 执行工具，返回原始业务输出。
   * tool-execution.ts 会负责调用 formatResult 将其转为 LLM 内容。
   */
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    context: ToolUseContext,
    onUpdate?: (partialOutput: TOutput) => void,
  ) => Promise<TOutput>;

  /**
   * 将执行结果格式化为 LLM 可用的内容。
   * 若未提供，则由 tool-execution.ts 提供默认 fallback（String(output) 转文本）。
   */
  formatResult?: (
    output: TOutput,
    toolCallId: string,
  ) => MessageContent[] | string;

  /** 是否为只读操作 */
  isReadOnly?: boolean;

  /** 是否支持并发执行 */
  isConcurrencySafe?: boolean;

  /** 是否为破坏性操作（如删除、覆盖、发送） */
  isDestructive?: boolean;
}
```

### `ToolUseContext` (`src/agent/types.ts`)

```typescript
export interface ToolUseContext {
  /** 中止信号 */
  abortSignal: AbortSignal;
  /** 当前会话消息列表 */
  messages: AgentMessage[];
  /** 当前可用工具列表 */
  tools: AgentTool<any, any>[];
  /** 会话 ID */
  sessionId?: string;
  /** 当前模型 */
  model?: Model<any>;
}
```

### `AgentToolResult`

```typescript
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}
```

---

## 3. 执行流水线

### 3.1 标准流程

`tool-execution.ts` 实现了严格的五阶段流水线：

```
1. prepareArguments  → 解析并预处理参数
2. validateInput      → Tool 级别的参数校验
3. checkPermissions   → Tool 级别的权限检查
4. execute            → 实际执行
5. formatResult       → 结果格式化（若 Tool 未提供，fallback 到现有行为）
```

### 3.2 事件流

各阶段会发出对应的 AgentEvent：

| 阶段 | 事件 |
|---|---|
| 开始 | `tool_execution_start` |
| 执行中 | `tool_execution_update`（通过 onUpdate 回调） |
| 结束 | `tool_execution_end` |
| 消息 | `message_start` / `message_end` |

### 3.3 并发模式

- **sequential**：工具按顺序一个一个执行
- **parallel**（默认）：工具同时执行，结果顺序保持一致

---

## 4. defineAgentTool 辅助函数

`src/agent/define-agent-tool.ts` 提供安全默认值（fail-closed）：

```typescript
export function defineAgentTool<TParams extends TSchema, TOutput>(
  tool: AgentTool<TParams, TOutput>,
): AgentTool<TParams, TOutput> {
  return {
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    validateInput: async (_params, _context) => ({ ok: true }),
    checkPermissions: async () => ({ allowed: true }),
    formatResult: (output) => [{ type: "text", text: String(output) }],
    ...tool,
  };
}
```

**默认值设计原则：**
- `isReadOnly: false` — 默认假设会写入
- `isConcurrencySafe: false` — 默认假设不安全
- `isDestructive: false` — 默认假设非破坏性
- `validateInput` — 默认放行
- `checkPermissions` — 默认放行
- `formatResult` — 默认转为文本

---

## 5. 内置 Tool 实现

### 5.1 工具列表

| 工具 | 文件 | 描述 |
|---|---|---|
| Bash | `src/agent/tools/bash.ts` | 执行 shell 命令 |
| Read | `src/agent/tools/read/read.ts` | 读取文件（文本、PDF、图片、Jupyter） |
| Write | `src/agent/tools/write.ts` | 写入文件 |
| Edit | `src/agent/tools/edit.ts` | 编辑文件（精确替换） |

### 5.2 ReadTool 架构

ReadTool 是一个复杂的工具，支持多种文件类型：

```
src/agent/tools/read/
├── read.ts        # 主入口，分发到各类型处理器
├── types.ts       # ReadOutput 类型定义
├── limits.ts      # token 限制相关（DEFAULT_LIMITS, roughTokenCount）
├── validation.ts  # 输入验证（expandPath, validateReadInput）
├── image.ts       # 图片读取（IMAGE_EXTENSIONS, readImage）
├── pdf.ts         # PDF 读取（readPDF）
├── notebook.ts    # Jupyter notebook 读取
```

**ReadTool 支持的文件类型：**
- 文本文件（带行号格式化）
- PDF（支持分页）
- 图片（base64 编码）
- Jupyter Notebook（.ipynb）

### 5.3 BashTool 示例

```typescript
export function createBashTool(cwd: string): AgentTool<typeof bashSchema, BashOutput> {
  return defineAgentTool({
    name: "Bash",
    label: "Bash",
    description: `Executes a given bash command and returns its output.`,
    parameters: bashSchema,
    outputSchema: bashOutputSchema,
    isReadOnly: false,
    isConcurrencySafe: true,
    async validateInput(params, _context) {
      // 检测被阻止的 sleep 命令
      if (!params.run_in_background) {
        const blockedSleep = detectBlockedSleepPattern(params.command);
        if (blockedSleep) {
          return {
            ok: false,
            message: `Blocked: ${blockedSleep}...`,
            errorCode: 10,
          };
        }
      }
      return { ok: true };
    },
    async checkPermissions(params, context) {
      // 权限检查逻辑
    },
    async execute(toolCallId, params, context, onUpdate) {
      // 执行命令
    },
  });
}
```

---

## 6. 工具导出

`src/agent/tools/index.ts` 统一导出所有工具：

```typescript
export { createReadTool } from "./read/index.js";
export { createWriteTool } from "./write.js";
export { createEditTool } from "./edit.js";
export { createBashTool } from "./bash.js";
```

---

## 7. 与 AgentLoopConfig 的关系

### 7.1 toolExecution 配置

```typescript
export interface AgentLoopConfig extends SimpleStreamOptions {
  // ...
  toolExecution?: ToolExecutionMode; // "sequential" | "parallel"
}
```

### 7.2 事件流

```
Agent.prompt()
    ↓
streamAssistantResponse()
    ↓
executeToolCalls()
    ↓
executeToolCallsSequential() 或 executeToolCallsParallel()
    ↓
emit: tool_execution_start
    ↓
prepareToolCall() → validateInput → checkPermissions
    ↓
executePreparedToolCall() → execute
    ↓
finalizeExecutedToolCall() → formatResult
    ↓
emit: tool_execution_end
    ↓
emit: message_start, message_end
```

---

## 8. 错误处理

| 场景 | 处理策略 |
|---|---|
| Tool not found | 返回 `Tool ${name} not found` 错误 |
| validateInput 失败 | 返回校验错误消息 |
| checkPermissions 拒绝 | 返回权限拒绝原因 |
| execute 抛出异常 | 捕获并转为错误结果 |
| formatResult 未提供 | fallback 到 `String(output)` |

---

## 9. 文件结构

```
src/agent/
  types.ts                    # AgentTool, ToolUseContext, AgentToolResult 定义
  define-agent-tool.ts        # defineAgentTool 工厂函数
  tool-execution.ts           # 执行流水线
  tool-execution.test.ts      # 单元测试
  tools/
    index.ts                  # 统一导出
    bash.ts                   # BashTool
    read/
      index.ts                # ReadTool 导出
      read.ts                # 主入口
      types.ts               # ReadOutput 类型
      limits.ts              # token 限制
      validation.ts          # 输入验证
      image.ts               # 图片读取
      pdf.ts                 # PDF 读取
      notebook.ts             # Notebook 读取
    write.ts                  # WriteTool
    edit.ts                   # EditTool
```

---

## 10. 设计原则总结

1. **垂直切片**：每个 Tool 是自包含的单元
2. **Fail-Closed 默认**：安全相关的字段默认不放行
3. **类型驱动**：使用 TypeBox 保证输入输出类型安全
4. **可观测**：全流程事件发射，便于调试和监控
5. **零外部依赖**：不耦合 UI 层，纯业务逻辑
