---
title: "SOP: TUI 集成 MCP Client 支持"
created: 2025-05-13
tags: [feature, other, 2025-05-13, mcp]
project: ys-code
---

## 背景

在 TUI coding-agent 中集成 MCP (Model Context Protocol) client 支持，使其能够：
1. 启动时自动检测并加载项目根目录的 `.mcp.json`
2. `/tools` 命令正确展示已连接的 MCP tools
3. 本地命令（如 `/tools`）执行后不再触发无意义的 AI 查询
4. MCP server 的 stderr 输出不污染 TUI 界面
5. MCP tool 执行结果能被 AI 正确读取，不会陷入无限重试循环

## 解决方案

### 伪代码步骤

1. **异步初始化 MCP，不阻塞构造函数**
   - AgentSession 构造函数内启动 MCP 初始化 Promise
   - 不 await，避免阻塞 session 创建
   - 暴露 `mcpReady()` API 供需要 tools 的调用方等待

2. **TUI hook 传递配置并保障生命周期**
   - useAgent 创建 AgentSession 时传入 `mcpConfigPath`
   - resetSession 重建 session 时**必须保留** `mcpConfigPath`
   - 否则 reset 后 MCP 会失效

3. **本地命令正确声明 skipPrompt**
   - `/tools` 等 local 命令返回文本结果时，必须设置 `skipPrompt: true`
   - 否则命令执行后会继续 query 主模型，产生无意义流式输出

4. **命令层等待 MCP 就绪**
   - `/tools` 命令执行时先 `await context.session.mcpReady()`
   - 读取 `context.session.tools` 渲染列表

5. **Transport 层过滤 stderr**
   - StdioClientTransport 默认 `stderr: "inherit"` 会将子进程 stderr 打印到父进程 stderr（TUI）
   - 统一设置为 `stderr: "ignore"`
   - **禁止**通过修改 `.mcp.json` 传参来抑制特定 server 的输出

6. **Tool result 正确序列化**
   - `defineAgentTool` 默认 `formatResult` 使用 `String(output)`
   - 对象会被序列化为 `"[object Object]"`，导致 AI 读不到结果而无限重试
   - 改为 `typeof output === "string" ? output : JSON.stringify(output, null, 2)`

### 关键信息

- src/agent/session.ts
  - class AgentSession
    - `mcpReady(): Promise<void>`
    - 构造函数内初始化 `mcpInitPromise`

- src/tui/hooks/useAgent.ts
  - `useAgent()` hook
  - `resetSession()` 必须保留 `mcpConfigPath`

- src/commands/tools/tools.ts
  - `call()` 等待 `mcpReady()` 后读取 tools

- src/commands/index.ts
  - `executeCommand()` 中 local 命令返回 `{ skipPrompt: true }`

- src/mcp/transport.ts
  - `createMcpServerConnection()` 中 `StdioClientTransport` 配置 `stderr: "ignore"`

- src/agent/define-agent-tool.ts
  - `defineAgentTool()` 默认 `formatResult`
  - 修复前：`String(output)` → `[object Object]`
  - 修复后：`typeof output === "string" ? output : JSON.stringify(output, null, 2)`

### 关键命令

```bash
# 验证 MCP 配置
bun run src/main.ts --web

# /tools 命令测试
/tools

# 类型检查
npx tsc --noEmit
```

### 关键决策

- **不在配置文件中 hack**：遇到 chrome-devtools MCP server 的 stderr 污染时，第一反应是修改 `.mcp.json` 加 `--no-usage-statistics` 等参数。这是错误的——`.mcp.json` 是用户配置，cc 也在使用；且该方案只抑制单个 server，未根治问题。

- **在 transport 层统一处理**：`StdioClientTransport` 默认 `stderr: "inherit"`，这才是根因。改为 `stderr: "ignore"` 后，所有 stdio MCP server 的 stderr 都不会污染 TUI，与 server 类型无关。

- **对齐 cc 的自动检测行为**：启动时自动检测 `.mcp.json`，不额外暴露配置开关，保持与 claude code 一致的用户体验。

- **默认 formatResult 不能直接用 `String()`**：`String({})` 会得到 `"[object Object]"`，对 AI 完全不可读。MCP tool 返回的都是复杂对象，默认序列化必须用 `JSON.stringify`。字符串输出保持原样，避免多余的引号包裹。
