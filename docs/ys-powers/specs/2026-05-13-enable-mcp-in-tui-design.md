# TUI 启用 MCP Client 支持

| 字段     | 值                                      |
|----------|----------------------------------------|
| 创建日期 | 2026-05-13                             |
| 分支     | `feat/mcp-client`                      |
| 依赖     | MCP Client 集成已完成（Slice 1-5）     |

---

## 1. Objective

让 ys-code 的 TUI 层能够自动检测并加载项目目录下的 `.mcp.json`，使 AgentSession 获得 MCP server 提供的 tools，并在 `/tools` 命令中正确展示。

和 cc（claude-code）行为对齐：启动时自动读取 `cwd/.mcp.json`，静默连接 MCP servers，tools 自动进入 agent 可用工具池。

---

## 2. Commands

无需新增命令。现有 `/tools` 命令即可展示 MCP tools。

---

## 3. Project Structure

涉及的文件（3 个）：

```
src/
  tui/hooks/useAgent.ts      # 传入 mcpConfigPath
  agent/session.ts           # 暴露 mcpReady() 方法
  commands/tools/tools.ts    # 等待 MCP 就绪后列出 tools
```

---

## 4. Code Style

- 保持现有模式：异步初始化不阻塞构造函数，Promise 在首次 `prompt()` 前 await
- `AgentSession` 方法命名遵循 camelCase，不引入 breaking change
- `/tools` command 保持现有输出格式，不改动 UI 结构

---

## 5. Testing Strategy

1. **单元测试**：`session.test.ts` 中验证 `mcpReady()` 行为
   - 未配置 MCP 时立即 resolve
   - 配置存在时等待 `loadMcpServers` 完成
2. **集成测试**：手动验证
   - 准备 `.mcp.json`（echo server）
   - 启动 TUI，输入 `/tools`
   - 期望输出包含 `mcp__echo__echo`

---

## 6. Boundaries

### Always Do
- 启动时自动检测 `cwd/.mcp.json`
- MCP 连接失败时**不阻断** TUI 启动，静默记录 warn log
- `/tools` 在 MCP 加载完成前调用时应等待，而非返回不完整列表

### Ask First
- 修改 StatusBar 展示 MCP 状态（属于第二步）
- `/tools` 分类展示 Built-in / MCP（属于第三步）

### Never Do
- 在 `AgentSession` 构造函数中同步阻塞等待 MCP 连接
- 修改 MCP client 层的 `loadMcpServers()`、`transport.ts` 等已稳定代码
- 引入新的外部依赖

---

## 7. Data Flow

```
TUI 启动
  └── useAgent 创建 AgentSession({ mcpConfigPath: cwd })
        └── 异步 initializeMcpTools() 开始运行
              └── loadMcpServers(cwd) → 连接 servers → registerTool()
        
用户输入 /tools
  └── commands/tools/tools.ts
        └── await context.session.mcpReady()
              └── 如果 mcpInitPromise 存在则等待，否则立即返回
        └── 读取 context.session.tools（已包含 MCP tools）
        └── 渲染列表
```

---

## 8. Implementation Steps

### Step 1: AgentSession 暴露 mcpReady()

在 `src/agent/session.ts` 中新增方法：

```typescript
/** 等待 MCP tools 初始化完成（如果已配置） */
async mcpReady(): Promise<void> {
  if (this.mcpInitPromise) {
    await this.mcpInitPromise;
  }
}
```

### Step 2: useAgent 传入 mcpConfigPath

在 `src/tui/hooks/useAgent.ts` 中修改 `AgentSession` 构造参数：

```typescript
new AgentSession({
  cwd: process.cwd(),
  model: options.model,
  apiKey: options.apiKey,
  mcpConfigPath: process.cwd(),  // 新增
})
```

### Step 3: /tools 等待 MCP 就绪

在 `src/commands/tools/tools.ts` 中：

```typescript
export const call: LocalCommandCall = async (_args, context) => {
  await context.session.mcpReady();  // 新增
  const toolList = context.session.tools;
  // ... 后续不变
};
```

---

## 9. Risk & Mitigation

| 风险 | 影响 | 应对 |
|------|------|------|
| MCP 连接慢导致 `/tools` 响应延迟 | 用户体验 | 10s 超时已在 connection.ts 中实现，超时会 reject，mcpReady() 不会无限等待 |
| `.mcp.json` 不存在时 mcpConfigPath 无效 | 无 | loadMcpConfig 在文件不存在时返回空配置，不会抛错 |
| 频繁调用 `/tools` 重复等待 | 低 | mcpInitPromise 在首次 resolve 后被清空（见 session.ts:395），后续调用立即返回 |
