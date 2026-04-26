# Tool TUI 渲染组件实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 EditTool 和 WriteTool 实现彩色 diff TUI 渲染，通过扩展 AgentTool 接口支持 renderResult() 方法返回结构化渲染数据。

**Architecture:** 工具层声明 renderResult() 返回 ToolRenderResult，tool-execution.ts 将其存入 AgentToolResult.renderData，session.ts 传递到 UIMessage，MessageItem 按 type 分发到 DiffRenderer 组件。

**Tech Stack:** TypeScript, Bun, Ink (React), diff 库

---

## 文件结构

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/agent/types.ts` | AgentTool/AgentToolResult 类型定义 | 修改：添加 ToolRenderResult，扩展接口 |
| `src/agent/tool-execution.ts` | 工具执行编排 | 修改：finalizeExecutedToolCall 调用 renderResult |
| `src/agent/tools/edit.ts` | EditTool 定义 | 修改：添加 renderResult 方法 |
| `src/agent/tools/write.ts` | WriteTool 定义 | 修改：添加 renderResult 方法 |
| `src/agent/session.ts` | Session 事件转换 | 修改：tool_end 事件传递 renderData |
| `src/tui/types.ts` | UI 消息类型 | 修改：UIMessage.tool_end 扩展 renderData |
| `src/tui/components/DiffRenderer.tsx` | Diff 渲染组件 | 新建：彩色 unified diff 渲染 |
| `src/tui/components/MessageItem.tsx` | 消息渲染分发 | 修改：按 renderData.type 分发 |
| `src/agent/tools/edit.test.ts` | EditTool 测试 | 修改：添加 renderResult 测试 |
| `src/agent/tools/write.test.ts` | WriteTool 测试 | 修改：添加 renderResult 测试 |

---

## Task 1: 扩展类型定义

**Files:**
- Modify: `src/agent/types.ts`

- [ ] **Step 1: 读取当前 types.ts 确认接口位置**

读取 `src/agent/types.ts` 第 45-52 行（AgentToolResult）和第 70-145 行（AgentTool）。

- [ ] **Step 2: 新增 ToolRenderResult 类型**

在 `src/agent/types.ts` 中，`AgentToolResult` 定义之前添加：

```typescript
/** 工具 TUI 渲染数据 */
export type ToolRenderResult =
  | { type: "structured_diff"; filePath: string; hunks: StructuredPatchHunk[] }
  | { type: "plain"; text: string };
```

注意：需要在文件顶部添加 `import type { StructuredPatchHunk } from "diff";`。

- [ ] **Step 3: 扩展 AgentToolResult**

修改 `src/agent/types.ts` 第 45-52 行：

```typescript
/** 工具执行结果
 * @template T 详细信息类型
 */
export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  /** TUI 渲染数据（可选） */
  renderData?: ToolRenderResult;
  /** 注入到消息列表的新消息（UI 隐藏，LLM 可见） */
  newMessages?: AgentMessage[];
  /** 上下文修改器 */
  contextModifier?: (messages: AgentMessage[]) => AgentMessage[];
}
```

- [ ] **Step 4: 扩展 AgentTool 接口**

在 `src/agent/types.ts` 的 `AgentTool` 接口中，在 `formatResult` 之后添加：

```typescript
  /**
   * 将执行结果转换为 TUI 渲染数据（可选）。
   * 若提供，则 TUI 层可使用结构化数据渲染更丰富的展示。
   */
  renderResult?: (
    output: TOutput,
    toolCallId: string,
  ) => ToolRenderResult | null;
```

- [ ] **Step 5: 提交**

```bash
git add src/agent/types.ts
git commit -m "feat(types): add ToolRenderResult and renderResult to AgentTool"
```

---

## Task 2: tool-execution.ts 调用 renderResult

**Files:**
- Modify: `src/agent/tool-execution.ts`

- [ ] **Step 1: 修改 finalizeExecutedToolCall**

找到 `src/agent/tool-execution.ts` 第 173-196 行的 `finalizeExecutedToolCall` 函数。

在 `content` 赋值之后、`result` 构造之前，添加 `renderData` 的提取逻辑：

```typescript
async function finalizeExecutedToolCall(
  prepared: { toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any, any>; args: unknown },
  executed: { output: unknown; isError: boolean },
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  let content: (import("../core/ai/index.js").TextContent | import("../core/ai/index.js").ImageContent)[];
  let details: unknown;
  let renderData: ToolRenderResult | undefined;

  if (executed.isError) {
    content = [{ type: "text", text: String(executed.output) }];
    details = {};
  } else {
    details = executed.output;
    if (prepared.tool.formatResult) {
      const formatted = prepared.tool.formatResult(executed.output, prepared.toolCall.id);
      content = typeof formatted === "string" ? [{ type: "text", text: formatted }] : formatted;
    } else {
      content = [{ type: "text", text: String(executed.output) }];
    }
    // 【新增】调用 renderResult 生成 TUI 渲染数据
    if (prepared.tool.renderResult) {
      const rendered = prepared.tool.renderResult(executed.output, prepared.toolCall.id);
      if (rendered) {
        renderData = rendered;
      }
    }
  }

  const result: AgentToolResult<any> = { content, details, renderData };
  return await emitToolCallOutcome(prepared.toolCall, result, executed.isError, emit);
}
```

- [ ] **Step 2: 验证编译通过**

```bash
bunx tsc --noEmit src/agent/tool-execution.ts
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/agent/tool-execution.ts
git commit -m "feat(tool-execution): call renderResult and pass renderData in AgentToolResult"
```

---

## Task 3: EditTool 实现 renderResult

**Files:**
- Modify: `src/agent/tools/edit.ts`

- [ ] **Step 1: 读取当前 edit.ts 确认 defineAgentTool 配置结构**

读取 `src/agent/tools/edit.ts` 第 144-373 行。

- [ ] **Step 2: 添加 renderResult 方法**

在 `defineAgentTool` 配置对象中，在 `formatResult` 之后添加：

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

- [ ] **Step 3: 添加单元测试**

在 `src/agent/tools/edit.test.ts` 末尾添加新 describe 块：

```typescript
describe('EditTool renderResult', () => {
  it('编辑文件应返回 structured_diff', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/edit-render.txt', 'hello world', 'utf-8');
    const stats = await stat('/tmp/edit-render.txt');
    cache.recordRead('/tmp/edit-render.txt', 'hello world', Math.floor(stats.mtimeMs));

    const tool = createEditTool('/tmp');
    try {
      const output = await tool.execute!('test-id', {
        file_path: '/tmp/edit-render.txt',
        old_string: 'hello',
        new_string: 'hi',
      }, mockContext(cache));

      expect(tool.renderResult).toBeDefined();
      const renderData = tool.renderResult!(output, 'test-id');
      expect(renderData).not.toBeNull();
      expect(renderData!.type).toBe('structured_diff');
      expect(renderData!.filePath).toBe('/tmp/edit-render.txt');
      expect(renderData!.hunks.length).toBeGreaterThan(0);
    } finally {
      await unlink('/tmp/edit-render.txt').catch(() => {});
    }
  });

  it('无变化时应返回 plain', () => {
    const tool = createEditTool('/tmp');
    const output = {
      filePath: '/tmp/test.txt',
      oldString: 'a',
      newString: 'b',
      originalFile: 'a',
      replaceAll: false,
      structuredPatch: [],
    };

    const renderData = tool.renderResult!(output, 'test-id');
    expect(renderData).not.toBeNull();
    expect(renderData!.type).toBe('plain');
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
bun test src/agent/tools/edit.test.ts
```

Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src/agent/tools/edit.ts src/agent/tools/edit.test.ts
git commit -m "feat(edit-tool): add renderResult returning structured_diff"
```

---

## Task 4: WriteTool 实现 renderResult

**Files:**
- Modify: `src/agent/tools/write.ts`

- [ ] **Step 1: 读取当前 write.ts 确认 defineAgentTool 配置结构**

读取 `src/agent/tools/write.ts` 第 28-167 行。

- [ ] **Step 2: 添加 renderResult 方法**

在 `defineAgentTool` 配置对象中，在 `formatResult` 之后添加：

```typescript
    renderResult(output, _toolCallId) {
      if (output.type === "create") {
        return { type: "plain", text: `Created ${output.filePath}` };
      }
      if (!output.structuredPatch || output.structuredPatch.length === 0) {
        return { type: "plain", text: `Updated ${output.filePath}` };
      }
      return {
        type: "structured_diff",
        filePath: output.filePath,
        hunks: output.structuredPatch,
      };
    },
```

- [ ] **Step 3: 添加单元测试**

在 `src/agent/tools/write.test.ts` 末尾添加新 describe 块：

```typescript
describe('WriteTool renderResult', () => {
  it('创建文件应返回 plain', async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool('/tmp');
    const output = await tool.execute!('test-id', {
      file_path: '/tmp/write-render-create.txt',
      content: 'new file',
    }, mockContext(cache));

    expect(tool.renderResult).toBeDefined();
    const renderData = tool.renderResult!(output, 'test-id');
    expect(renderData).not.toBeNull();
    expect(renderData!.type).toBe('plain');
    expect((renderData as any).text).toContain('Created');

    await unlink('/tmp/write-render-create.txt').catch(() => {});
  });

  it('更新文件应返回 structured_diff', async () => {
    const cache = new FileStateCache();
    await writeFile('/tmp/write-render-update.txt', 'old content', 'utf-8');
    const stats = await stat('/tmp/write-render-update.txt');
    cache.recordRead('/tmp/write-render-update.txt', 'old content', Math.floor(stats.mtimeMs));

    const tool = createWriteTool('/tmp');
    const output = await tool.execute!('test-id', {
      file_path: '/tmp/write-render-update.txt',
      content: 'new content',
    }, mockContext(cache));

    const renderData = tool.renderResult!(output, 'test-id');
    expect(renderData).not.toBeNull();
    expect(renderData!.type).toBe('structured_diff');
    expect(renderData!.filePath).toBe('/tmp/write-render-update.txt');
    expect(renderData!.hunks.length).toBeGreaterThan(0);

    await unlink('/tmp/write-render-update.txt').catch(() => {});
  });
});
```

- [ ] **Step 4: 运行测试**

```bash
bun test src/agent/tools/write.test.ts
```

Expected: 全部通过

- [ ] **Step 5: 提交**

```bash
git add src/agent/tools/write.ts src/agent/tools/write.test.ts
git commit -m "feat(write-tool): add renderResult returning structured_diff or plain"
```

---

## Task 5: session.ts 扩展 tool_end 事件传递 renderData

**Files:**
- Modify: `src/agent/session.ts`

- [ ] **Step 1: 扩展 AgentSessionEvent 类型**

找到 `src/agent/session.ts` 第 18-24 行的 `AgentSessionEvent` 类型定义，修改 `tool_end` 分支：

```typescript
  | { type: "tool_end"; toolCallId: string; toolName: string; isError: boolean; summary: string; timeMs: number; renderData?: import("./types.js").ToolRenderResult }
```

- [ ] **Step 2: 修改 handleAgentEvent 传递 renderData**

找到 `src/agent/session.ts` 第 314-330 行的 `tool_execution_end` 处理，修改 `this.emit` 调用：

```typescript
      case "tool_execution_end": {
        const startTime = this.toolStartTimes.get(event.toolCallId) ?? Date.now();
        this.toolStartTimes.delete(event.toolCallId);
        const summary = event.isError
          ? String((event.result as any)?.content?.[0]?.text ?? "error")
          : String((event.result as any)?.content?.[0]?.text ?? "");
        const elapsed = Date.now() - startTime;
        logger.info("Tool ended", { toolName: event.toolName, isError: event.isError, timeMs: elapsed });
        this.emit({
          type: "tool_end",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          isError: event.isError,
          summary: summary || "done",
          timeMs: elapsed,
          renderData: (event.result as any)?.renderData,  // ← 新增
        });
        break;
      }
```

- [ ] **Step 3: 验证编译通过**

```bash
bunx tsc --noEmit src/agent/session.ts
```

Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/agent/session.ts
git commit -m "feat(session): pass renderData through tool_end event"
```

---

## Task 6: UIMessage 扩展 renderData

**Files:**
- Modify: `src/tui/types.ts`

- [ ] **Step 1: 扩展 UIMessage.tool_end**

找到 `src/tui/types.ts` 第 11 行，修改：

```typescript
  | { type: "tool_end"; toolName: string; isError: boolean; summary: string; timeMs: number; renderData?: import("../agent/types.js").ToolRenderResult }
```

- [ ] **Step 2: 提交**

```bash
git add src/tui/types.ts
git commit -m "feat(tui-types): add renderData to UIMessage.tool_end"
```

---

## Task 7: 新建 DiffRenderer 组件

**Files:**
- Create: `src/tui/components/DiffRenderer.tsx`

- [ ] **Step 1: 创建 DiffRenderer 组件**

```typescript
// src/tui/components/DiffRenderer.tsx
import { Box, Text } from "ink";
import React from "react";
import type { StructuredPatchHunk } from "diff";

/** DiffRenderer 组件属性 */
interface DiffRendererProps {
  /** 文件路径 */
  filePath: string;
  /** Diff hunks 列表 */
  hunks: StructuredPatchHunk[];
}

/**
 * 渲染彩色 unified diff。
 * - 添加行（+）：绿色
 * - 删除行（-）：红色
 * - 标题行（@@）：黄色
 * - 上下文行（空格）：灰色
 */
export function DiffRenderer({ filePath, hunks }: DiffRendererProps) {
  return (
    <Box flexDirection="column" paddingLeft={2}>
      <Text color="cyan">{`--- a/${filePath}`}</Text>
      <Text color="cyan">{`+++ b/${filePath}`}</Text>
      {hunks.map((hunk, hunkIndex) => (
        <Box key={hunkIndex} flexDirection="column">
          <Text color="yellow">
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </Text>
          {hunk.lines.map((line, lineIndex) => {
            if (line.startsWith("+")) {
              return <Text key={lineIndex} color="green">{line}</Text>;
            }
            if (line.startsWith("-")) {
              return <Text key={lineIndex} color="red">{line}</Text>;
            }
            return <Text key={lineIndex} color="gray">{line}</Text>;
          })}
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: 验证编译通过**

```bash
bunx tsc --noEmit src/tui/components/DiffRenderer.tsx --jsx react-jsx
```

Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/tui/components/DiffRenderer.tsx
git commit -m "feat(diff-renderer): add colored unified diff component"
```

---

## Task 8: MessageItem 按 renderData 分发渲染

**Files:**
- Modify: `src/tui/components/MessageItem.tsx`

- [ ] **Step 1: 导入 DiffRenderer**

在 `src/tui/components/MessageItem.tsx` 顶部添加：

```typescript
import { DiffRenderer } from "./DiffRenderer.js";
```

- [ ] **Step 2: 修改 tool_end 分支**

替换 `src/tui/components/MessageItem.tsx` 第 57-68 行：

```typescript
    case "tool_end": {
      const status = message.isError ? "ERR" : "OK";
      const timeSec = (message.timeMs / 1000).toFixed(1);
      const color = message.isError ? "red" : "green";

      // 结构化渲染：diff 工具使用 DiffRenderer
      if (!message.isError && message.renderData?.type === "structured_diff") {
        return (
          <Box flexDirection="column">
            <Text color={color}>
              {status} {message.toolName} {"->"} {timeSec}s
            </Text>
            <DiffRenderer
              filePath={message.renderData.filePath}
              hunks={message.renderData.hunks}
            />
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

- [ ] **Step 3: 验证编译通过**

```bash
bunx tsc --noEmit src/tui/components/MessageItem.tsx --jsx react-jsx
```

Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/tui/components/MessageItem.tsx
git commit -m "feat(message-item): dispatch to DiffRenderer for structured_diff renderData"
```

---

## Task 9: 回归测试

**Files:**
- 全部上述修改的文件

- [ ] **Step 1: 运行 agent 工具测试**

```bash
bun test src/agent/tools/edit.test.ts src/agent/tools/write.test.ts
```

Expected: 全部通过

- [ ] **Step 2: 运行 tool-execution 测试**

```bash
bun test src/agent/tool-execution.test.ts
```

Expected: 全部通过

- [ ] **Step 3: 运行 session 测试**

```bash
bun test src/agent/session.test.ts
```

Expected: 全部通过

- [ ] **Step 4: 运行完整测试套件**

```bash
bun test
```

Expected: 全部通过

- [ ] **Step 5: 最终提交**

```bash
git commit -m "feat: tool TUI render with renderResult (closes #design-2026-04-26)" --allow-empty
```

---

## 自我审查

### Spec 覆盖检查

| 设计文档需求 | 对应任务 |
|------------|---------|
| 扩展 AgentTool 接口 | Task 1 |
| 扩展 AgentToolResult | Task 1 |
| tool-execution.ts 调用 renderResult | Task 2 |
| EditTool renderResult | Task 3 |
| WriteTool renderResult | Task 4 |
| session.ts 传递 renderData | Task 5 |
| UIMessage 扩展 | Task 6 |
| DiffRenderer 组件 | Task 7 |
| MessageItem 分发 | Task 8 |
| 单元测试 | Task 3, 4 |
| 回归测试 | Task 9 |

**无遗漏。**

### Placeholder 扫描

- 无 "TBD", "TODO", "implement later"
- 每个步骤包含完整代码
- 每个步骤包含确切命令和期望输出

### 类型一致性

- `ToolRenderResult` 在 Task 1 定义，后续任务一致使用
- `renderData` 字段名在 types.ts, tool-execution.ts, session.ts, types.ts 中一致
- `AgentTool.renderResult` 签名在 Task 1 定义，edit.ts/write.ts 实现匹配

---

## 执行交接

**Plan complete and saved to `docs/superpowers/plans/2026-04-26-tool-tui-render.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
