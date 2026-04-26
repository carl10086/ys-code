# Tool TUI 渲染组件设计文档

> 为 ys-code 实现 per-tool 的 TUI 渲染能力，解决 Edit/Write 工具 diff 输出单色显示问题。
> 与 Claude Code 架构对齐：工具层声明渲染数据，TUI 层按类型统一分发。

---

## 1. 背景与问题

当前 EditTool 和 WriteTool 的 diff 输出在 TUI 中全部显示为绿色文本，原因是：

1. `formatResult()` 返回的完整 diff 文本被塞进 `UIMessage.tool_end.summary`（单行字符串）
2. `MessageItem.tsx` 用单个 `<Text color="green">` 渲染整个 diff
3. `--- / +++ / @@` 标题、删除行、添加行没有颜色区分

根本问题：**TUI 层拿不到结构化数据**，只能渲染工具格式化后的纯文本。

## 2. 关键发现（已有基础设施）

`src/agent/tool-execution.ts:178-195` 中已经同时保存了两份数据：

```typescript
// finalizeExecutedToolCall
details = executed.output;                          // ← 原始输出（含 structuredPatch）
content = tool.formatResult(output, toolCallId);    // ← 给 LLM 的纯文本

const result: AgentToolResult<any> = { content, details };
```

**`details` 已经存在于每一个 tool result 中，只是被丢弃在中途。**

当前数据流断裂点：`session.ts` 的 `handleAgentEvent` 只提取 `content[0].text` 作为 `summary`，完全没有传递 `details`。

## 3. 设计目标

| 目标 | 说明 |
|------|------|
| 对齐 CC 架构 | 工具声明 `renderResult()` 返回标准化渲染数据，TUI 按类型分发 |
| 分离 LLM/TUI | `formatResult()` 继续给 LLM 纯文本；`renderResult()` 给 TUI 结构化数据 |
| 向后兼容 | 现有工具不写 `renderResult` 也能正常工作，回退到纯文本 |
| 可扩展 | 新增工具只需在工具定义中加 `renderResult`，不需要改 UI 代码 |

## 4. 核心设计

### 4.1 消息分层模型（与 CC 一致）

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: TUI 渲染层                                          │
│   - MessageItem 检查 message.renderData?.type               │
│   - 匹配则渲染结构化组件（DiffRenderer）                      │
│   - 不匹配则回退到纯文本                                      │
├─────────────────────────────────────────────────────────────┤
│ Layer 2: AgentSession 事件层                                 │
│   - tool_end 事件携带 { summary, renderData? }              │
│   - summary 来自 formatResult（给 LLM 的文本）               │
│   - renderData 来自 renderResult（给 TUI 的结构化数据）       │
├─────────────────────────────────────────────────────────────┤
│ Layer 1: 工具执行层                                          │
│   - execute() → 原始输出                                     │
│   - formatResult() → LLM 文本                               │
│   - renderResult() → ToolRenderResult（可选）                │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 ToolRenderResult 类型定义

```typescript
// src/agent/types.ts

/** 工具 TUI 渲染数据 */
export type ToolRenderResult =
  | { type: "structured_diff"; filePath: string; hunks: StructuredPatchHunk[] }
  | { type: "plain"; text: string };

/** 扩展 AgentTool 接口 */
export interface AgentTool<TParameters extends TSchema = TSchema, TOutput = unknown> {
  // ... 现有字段不变 ...

  /** 将执行结果转换为 TUI 渲染数据（可选） */
  renderResult?: (output: TOutput, toolCallId: string) => ToolRenderResult | null;
}

/** 扩展 AgentToolResult */
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  renderData?: ToolRenderResult;  // ← 新增
  newMessages?: AgentMessage[];
  contextModifier?: (messages: AgentMessage[]) => AgentMessage[];
}
```

### 4.3 数据流（完整链路）

```
EditTool.execute()
  └─→ { filePath, structuredPatch[], originalFile, ... }  (EditOutput)
        │
        ├──→ tool.formatResult(output) 
        │      └─→ "The file X has been updated.\n\n--- a/...\n+++ b/..."
        │            (给 LLM 的纯文本)
        │
        └──→ tool.renderResult(output)
               └─→ { type: "structured_diff", filePath, hunks: structuredPatch }
                     (给 TUI 的结构化数据)

finalizeExecutedToolCall()
  └─→ AgentToolResult = { content: [formatResult结果], details: EditOutput, renderData }
        │
        ├──→ emit tool_execution_end → event.result = AgentToolResult
        │
        └──→ emit message_start/end → ToolResultMessage（给 LLM 历史）

session.ts handleAgentEvent()
  └─→ emit { type: "tool_end", summary: content[0].text, renderData }
        │
        └─→ UIMessage.tool_end = { summary, renderData, ... }

MessageItem.tsx
  └─→ if (renderData?.type === "structured_diff")
        └─→ <DiffRenderer filePath={...} hunks={...} />
      else
        └─→ <Text>{summary}</Text> (fallback)
```

## 5. 具体改动点

### 5.1 类型定义扩展（`src/agent/types.ts`）

新增 `ToolRenderResult` 类型，扩展 `AgentTool` 和 `AgentToolResult`。

### 5.2 工具执行层（`src/agent/tool-execution.ts`）

在 `finalizeExecutedToolCall` 中调用 `renderResult`：

```typescript
const renderData = !executed.isError && prepared.tool.renderResult
  ? prepared.tool.renderResult(executed.output, prepared.toolCall.id)
  : null;

const result: AgentToolResult<any> = { content, details, renderData: renderData ?? undefined };
```

### 5.3 EditTool（`src/agent/tools/edit.ts`）

在 `defineAgentTool` 配置中添加：

```typescript
renderResult(output, _toolCallId) {
  if (!output.structuredPatch || output.structuredPatch.length === 0) {
    return { type: "plain", text: "File updated (no diff available)" };
  }
  return {
    type: "structured_diff",
    filePath: output.filePath,
    hunks: output.structuredPatch,
  };
},
```

### 5.4 WriteTool（`src/agent/tools/write.ts`）

类似 EditTool，但创建文件时返回 `plain` 类型：

```typescript
renderResult(output, _toolCallId) {
  if (output.type === "create") {
    return { type: "plain", text: `Created ${output.filePath}` };
  }
  return {
    type: "structured_diff",
    filePath: output.filePath,
    hunks: output.structuredPatch ?? [],
  };
},
```

### 5.5 Session 层（`src/agent/session.ts`）

扩展 `AgentSessionEvent.tool_end`：

```typescript
| { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; summary: string; timeMs: number; renderData?: ToolRenderResult }
```

在 `handleAgentEvent` 的 `tool_execution_end` 处理中传递 `renderData`：

```typescript
this.emit({
  type: "tool_end",
  // ... 现有字段 ...
  renderData: (event.result as any)?.renderData,
});
```

### 5.6 TUI 类型（`src/tui/types.ts`）

扩展 `UIMessage.tool_end`：

```typescript
| { type: "tool_end"; toolName: string; isError: boolean; summary: string; timeMs: number; renderData?: import("../agent/types.js").ToolRenderResult }
```

### 5.7 Diff 渲染组件（新建 `src/tui/components/DiffRenderer.tsx`）

```typescript
import { Box, Text } from "ink";
import React from "react";
import type { StructuredPatchHunk } from "diff";

interface DiffRendererProps {
  filePath: string;
  hunks: StructuredPatchHunk[];
}

export function DiffRenderer({ filePath, hunks }: DiffRendererProps) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="cyan">--- a/{filePath}</Text>
      <Text color="cyan">+++ b/{filePath}</Text>
      {hunks.map((hunk, hi) => (
        <Box key={hi} flexDirection="column">
          <Text color="yellow">
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </Text>
          {hunk.lines.map((line, li) => {
            if (line.startsWith("+")) return <Text key={li} color="green">{line}</Text>;
            if (line.startsWith("-")) return <Text key={li} color="red">{line}</Text>;
            return <Text key={li} color="gray">{line}</Text>;
          })}
        </Box>
      ))}
    </Box>
  );
}
```

### 5.8 MessageItem 分发（`src/tui/components/MessageItem.tsx`）

修改 `tool_end` 分支：

```typescript
case "tool_end": {
  const status = message.isError ? "ERR" : "OK";
  const timeSec = (message.timeMs / 1000).toFixed(1);
  const color = message.isError ? "red" : "green";

  // 结构化渲染
  if (!message.isError && message.renderData?.type === "structured_diff") {
    return (
      <Box flexDirection="column">
        <Text color={color}>{status} {message.toolName} {"->"} {timeSec}s</Text>
        <DiffRenderer filePath={message.renderData.filePath} hunks={message.renderData.hunks} />
      </Box>
    );
  }

  // Fallback 纯文本
  return (
    <Box flexDirection="column">
      <Text color={color}>
        {status} {message.toolName} {"->"} {message.summary} {timeSec}s
      </Text>
    </Box>
  );
}
```

## 6. 向后兼容

| 场景 | 行为 |
|------|------|
| 旧工具没有 `renderResult` | `renderData` 为 `undefined`，UI 回退到纯文本 |
| 旧 session 文件读取 | 不涉及，本改动只影响运行时事件流 |
| 新代码读取旧数据 | `renderData` 可能缺失，回退到纯文本 |
| 工具返回 `null` renderResult | UI 回退到纯文本 |

## 7. 与 CC 架构对比

| 维度 | Claude Code | ys-code（本设计） |
|------|------------|------------------|
| LLM 文本 | `mapToolResultToToolResultBlockParam()` | `formatResult()` |
| TUI 渲染 | `renderToolResultMessage()` 返回 React 节点 | `renderResult()` 返回结构化数据，TUI 层映射到组件 |
| 分离程度 | 工具文件同时导入 UI 组件 | 工具层只返回数据，不依赖 React |
| 优势 | 工具完全控制渲染 | 工具层与 TUI 层解耦，可测试性更好 |

## 8. 验收标准

- [ ] EditTool 编辑文件后，TUI 显示彩色 diff（添加绿色、删除红色、标题中性）
- [ ] WriteTool 创建文件后，TUI 显示纯文本创建提示
- [ ] WriteTool 更新文件后，TUI 显示彩色 diff
- [ ] 工具执行错误时，TUI 仍显示红色错误文本（不尝试结构化渲染）
- [ ] 未实现 `renderResult` 的工具，TUI 保持现有纯文本行为
- [ ] `formatResult()` 返回的文本仍正确进入 LLM 上下文
- [ ] 新增单元测试覆盖 `renderResult` 方法（EditTool、WriteTool）
- [ ] 现有测试全部通过

## 9. 非功能需求

| 需求 | 说明 |
|------|------|
| 性能 | `renderResult` 是纯数据转换，无 I/O，不影响响应时间 |
| 依赖 | `DiffRenderer` 依赖 `diff` 包的 `StructuredPatchHunk` 类型，已存在于项目依赖 |
| 可测试性 | `renderResult` 是同步纯函数，可独立单元测试 |
| 可扩展性 | 新增渲染类型只需扩展 `ToolRenderResult` 联合类型和对应组件 |

---

*文档版本: v1.0*  
*创建日期: 2026-04-26*  
*对应实现计划: docs/superpowers/plans/2026-04-26-tool-tui-render.md*
