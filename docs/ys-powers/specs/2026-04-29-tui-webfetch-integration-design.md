# Spec: TUI WebFetchTool 集成

## Objective

将已有的 `WebFetchTool`（远程 URL 内容抓取工具）注册到 TUI（终端用户界面）中运行的 AgentSession，使 agent 能够在 TUI 环境下调用该工具抓取网页内容。

**背景：**
- `WebFetchTool` 已在 `src/agent/tools/webfetch.ts` 实现，具备 SSRF 防护、HTML→Markdown 转换、重定向校验、超时控制等能力
- 但目前 `AgentSession` 的默认工具列表未包含 `WebFetchTool`，TUI 中的 agent 无法使用

**用户故事：**
- 作为 TUI 用户，我可以让 agent 抓取并分析网页内容，而不需要手动复制粘贴

**成功标准：**
- [ ] TUI 启动的 AgentSession 默认包含 WebFetchTool
- [ ] LLM 能够识别并调用 WebFetchTool
- [ ] TUI 中 WebFetchTool 的调用展示为简短摘要（而非完整网页内容刷屏）
- [ ] 所有现有测试通过，WebFetchTool 相关测试通过

## Tech Stack

- **Runtime:** Bun + TypeScript
- **TUI Framework:** Ink + React
- **现有依赖:** turndown（HTML→Markdown 转换，已用于 WebFetchTool）
- **无需新增依赖**

## Commands

```bash
# 运行 WebFetchTool 相关测试
bun test ./src/agent/tools/webfetch-utils.test.ts ./src/agent/tools/webfetch.test.ts

# 完整回归测试
bun test

# 启动 TUI 验证
bun run start
```

## Project Structure

```
src/
  agent/
    session.ts              → 修改：默认工具列表加入 createWebFetchTool
    tools/
      webfetch.ts           → 修改：添加 renderResult() 方法
      index.ts              → 已有：导出 createWebFetchTool（无需修改）
  tui/
    components/
      MessageItem.tsx       → 修改：支持 renderData.type === "plain"
```

## Code Style

遵循现有模式，最小改动。

**AgentSession 工具注册示例：**
```ts
// session.ts 构造函数
const tools = options.tools ?? [
  createReadTool(options.cwd),
  createWriteTool(options.cwd),
  createEditTool(options.cwd),
  createBashTool(options.cwd),
  createGlobTool(options.cwd),
  createWebFetchTool(),  // ← 新增
];
```

**renderResult 示例：**
```ts
// webfetch.ts
renderResult(output) {
  return {
    type: "plain",
    text: `Fetched ${output.url} (${output.code} ${output.codeText}, ${output.bytes} bytes)`,
  };
}
```

**TUI 渲染示例：**
```tsx
// MessageItem.tsx
if (!message.isError && message.renderData) {
  if (message.renderData.type === "structured_diff") {
    // 现有逻辑
  } else if (message.renderData.type === "plain") {
    return (
      <Box flexDirection="column">
        <Text color={color}>
          {status} {message.toolName} {"->"} {message.renderData.text} {timeSec}s
        </Text>
      </Box>
    );
  }
}
```

## Testing Strategy

- **单元测试：** WebFetchTool 已有完整测试（webfetch.test.ts、webfetch-utils.test.ts），无需新增
- **集成测试：** 启动 TUI，发送 prompt 让 agent 抓取一个公开网页（如 `https://example.com`），验证工具调用和展示
- **回归测试：** `bun test` 全量通过

## Boundaries

- **Always:**
  - 运行测试后再提交
  - 保持 formatResult 返回完整内容（供 LLM 使用）
  - renderResult 返回简短人类可读摘要（供 TUI 展示）

- **Ask first:**
  - 修改 WebFetchTool 的核心抓取逻辑（SSRF 防护、重定向处理等）
  - 添加新的 TUI 渲染类型（超出 plain 和 structured_diff）
  - 引入新依赖

- **Never:**
  - 让 TUI 直接展示完整网页内容（会导致刷屏）
  - 修改其他工具的展示行为（只改 WebFetchTool 相关）
  - 在 main 分支直接 commit（已通过 feature branch 工作）

## Success Criteria

1. `AgentSession` 默认工具列表包含 `WebFetchTool`
2. TUI 中 agent 能成功调用 `WebFetchTool` 抓取网页
3. TUI 展示为简短摘要，如：`OK WebFetch -> Fetched https://example.com (200 OK, 12345 bytes) 1.2s`
4. LLM 仍能获取完整抓取内容用于分析和回答
5. 所有现有测试通过

## Plan

### 任务分解

1. **注册 WebFetchTool 到 AgentSession**
   - 修改 `src/agent/session.ts`：导入 `createWebFetchTool` 并加入默认工具列表
   - 验证：`bun test` 通过

2. **为 WebFetchTool 添加 renderResult**
   - 修改 `src/agent/tools/webfetch.ts`：添加 `renderResult()` 方法，返回 `{ type: "plain", text: "Fetched ..." }`
   - 验证：`bun test ./src/agent/tools/webfetch.test.ts` 通过

3. **TUI 支持 plain renderData 展示**
   - 修改 `src/tui/components/MessageItem.tsx`：处理 `renderData.type === "plain"`
   - 验证：启动 TUI，让 agent 抓取网页，确认展示为简短摘要

### 依赖顺序
任务 1 和 2 可以并行；任务 3 依赖任务 2（需要 renderData 类型定义）。
