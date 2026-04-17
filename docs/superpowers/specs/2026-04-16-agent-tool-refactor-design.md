# AgentTool 垂直切片化重构设计文档

日期：2026-04-16

## 背景与问题

当前 `ys-code` 的 `AgentTool` 仅包含 `name`、`description`、`parameters`、`label` 和 `execute`，是一个**执行函数签名**。与 `claude-code-haha`（cc）的 `Tool` 设计相比，存在以下结构性不足：

1. **生命周期不完整**：参数校验、权限检查、结果格式化都在 `tool-execution.ts` 或外置钩子中，未内聚在 Tool 内部
2. **输出结构不透明**：只有 `parameters`（输入 schema），没有 `outputSchema`
3. **缺少运行属性标记**：没有 `isReadOnly`、`isDestructive`、`isConcurrencySafe`，调度层无法根据 Tool 特性做智能决策
4. **缺少默认值辅助函数**：每写一个 Tool 都要完整实现接口，缺少类似 cc `buildTool` 的安全默认值填充机制
5. **`description` 静态化**：当前是编译期写死的 `string`，无法根据上下文动态生成

## 设计目标

将 `AgentTool` 重构为**自包含的垂直切片**：每个 Tool 自己负责参数校验、权限判断、执行、结果格式化，同时支持基于上下文的动态描述。

**约束条件：**
- 继续使用 **TypeBox**，不换 Zod
- **彻底排除**与 TUI / Ink / OpenTUI 的耦合
- `AgentEvent` 事件流和 `Agent` 公开 API 保持不变
- `beforeToolCall` / `afterToolCall` 外置钩子标记废弃，由 Tool 内聚权限替代

---

## 一、AgentTool 接口改造

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
  parameters: TParameters;

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
  ) => Promise<{ ok: true } | { ok: false; message: string }>;

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

---

## 二、ToolUseContext 轻量上下文

为避免重蹈 cc `ToolUseContext` 包含 AppState/JSX 的覆辙，我们只保留**执行和决策必需**的最小上下文：

```typescript
export interface ToolUseContext {
  /** 中止信号 */
  abortSignal: AbortSignal;
  
  /** 当前会话消息列表 */
  messages: AgentMessage[];
  
  /** 当前可用工具列表 */
  tools: AgentTool<any>[];
  
  /** 会话 ID */
  sessionId?: string;
  
  /** 当前模型 */
  model?: Model<any>;
}
```

---

## 三、tool-execution.ts 标准化流水线

改造后的执行流程严格按以下顺序执行：

```
1. prepareArguments  → 解析并预处理参数
2. validateInput      → Tool 级别的参数校验
3. checkPermissions   → Tool 级别的权限检查
4. execute            → 实际执行
5. formatResult       → 结果格式化（若 Tool 未提供，fallback 到现有行为）
```

`tool-execution.ts` 本身**不再包含任何 Tool-specific 的逻辑**，只负责：
- 按顺序调用各阶段
- 在各阶段 emit `AgentEvent`（`tool_execution_start/update/end`）
- 处理异常并包装为 `ToolResultMessage`

---

## 四、defineAgentTool() 辅助函数

类似 cc 的 `buildTool`，提供安全默认值（fail-closed）：

```typescript
export function defineAgentTool<TParams extends TSchema, TOutput>(
  tool: AgentTool<TParams, TOutput>,
): AgentTool<TParams, TOutput> {
  return {
    isReadOnly: false,
    isConcurrencySafe: false,
    isDestructive: false,
    validateInput: async () => ({ ok: true }),
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

## 五、边界与不变项

| 项目 | 变更策略 |
|------|----------|
| `AgentEvent` 事件流 | **保持不变**，`tool_execution_start/update/end` 等事件签名和语义不变 |
| `Agent` 公开 API | **保持不变**，`agent.prompt()`、`agent.continue()`、`agent.subscribe()` 签名不变 |
| `beforeToolCall` / `afterToolCall` | **从 `AgentLoopConfig` 中移除**（或先标记 `@deprecated` 且不生效），由 Tool 内聚的 `checkPermissions` 完全替代 |
| TUI 耦合 | **绝对禁止**，不引入任何 React/Ink/OpenTUI 相关类型或方法 |
| 校验库 | **继续用 TypeBox**，不换 Zod |

---

## 六、迁移路径

1. **Phase 1：类型层改造**
   - 修改 `src/agent/types.ts` 中的 `AgentTool` 和新增 `ToolUseContext`
   - 新增 `src/agent/define-agent-tool.ts` 提供 `defineAgentTool()`

2. **Phase 2：执行层改造**
   - 重构 `src/agent/tool-execution.ts`，实现标准化流水线
   - 移除 `beforeToolCall` / `afterToolCall` 相关逻辑

3. **Phase 3：存量 Tool 迁移**
   - 将 `src/agent/tools/bash.ts`、`read.ts`、`write.ts`、`edit.ts` 等迁移到新接口
   - 用 `defineAgentTool()` 包裹，补充 `outputSchema` 和运行属性标记

4. **Phase 4：验证**
   - 确保 `AgentEvent` 流和 `Agent` 公开 API 行为不变
   - 编写单元测试覆盖流水线各阶段
