# ys-code MCP Client 技术文档

## 1. 概述

ys-code 的 MCP（Model Context Protocol）client 实现让 agent 能够连接外部 MCP server，将其提供的 tools、resources、prompts 转换为 agent 可用的 `AgentTool`，注入 agent loop。

**当前角色**：纯 client。ys-code 不实现 MCP server，也不提供 `roots` 或 `sampling` capability。

**支持的原语**：
- `tools` — MCP tool → `AgentTool`，可被 LLM 调用
- `resources` — MCP resource → `AgentTool`（List/Read）
- `prompts` — MCP prompt → `AgentTool`（List/Get）

**支持的 transport**：
- `stdio` — 启动子进程，通过 stdin/stdout JSON-RPC 通信
- `http` — streamable HTTP transport（MCP SDK 原生支持）

**配置来源**：项目级 `.mcp.json`（位于 `cwd` 下），启动时自动检测，不存在则静默跳过。

---

## 2. 架构分层

```
┌─────────────────────────────────────────────┐
│  Agent Layer                                │
│  - AgentSession 异步初始化 MCP              │
│  - mcpReady() 暴露给命令层                  │
│  - Tool 结果序列化后返回 LLM                │
├─────────────────────────────────────────────┤
│  Adapter Layer                              │
│  - tools.ts:     MCP tool → AgentTool       │
│  - resources.ts: MCP resource → AgentTool   │
│  - prompts.ts:   MCP prompt → AgentTool     │
│  - namespacing: mcp__{server}__{tool}      │
│  - schema 转换: JSON Schema → TypeBox       │
├─────────────────────────────────────────────┤
│  Connection Layer                           │
│  - McpConnectionManager                     │
│  - 连接生命周期、超时控制（10s）            │
│  - 失败隔离：单 server 失败不影响其他       │
├─────────────────────────────────────────────┤
│  Transport Layer                            │
│  - StdioClientTransport（子进程管理）       │
│  - StreamableHTTPClientTransport            │
│  - stderr 统一设置为 "ignore"               │
├─────────────────────────────────────────────┤
│  SDK Layer                                  │
│  - @modelcontextprotocol/sdk                │
│  - Client / JSON-RPC / handshake            │
└─────────────────────────────────────────────┘
```

---

## 3. 数据流

### 3.1 启动阶段

```
AgentSession 构造
    │
    ▼
initializeMcpTools(cwd)
    │
    ▼
loadMcpConfig(cwd) ──→ 读取 cwd/.mcp.json
    │                      不存在 → 静默返回空配置
    ▼
McpConnectionManager.connectAll()
    │
    ├──→ 对每个 server：
    │       createMcpServerConnection() ──→ StdioClientTransport / HTTPTransport
    │       client.connect() ──→ JSON-RPC handshake
    │       检测 server capabilities
    │       仅对声明的 capability 发起 list 请求
    │       tools/list → 转换为 AgentTool
    │       resources/list → 转换为 AgentTool
    │       prompts/list → 转换为 AgentTool
    │
    ▼
registerTool() 注入 agent.tools 数组
```

### 3.2 运行阶段（Tool 调用）

```
LLM 响应包含 toolCall
    │
    ▼
agent loop 匹配 tool name（含 namespacing）
    │
    ▼
AgentTool.execute(toolCallId, params, context)
    │
    ▼
MCP adapter: connection.callTool(name, params)
    │
    ▼
MCP SDK: client.callTool({ name, arguments })
    │
    ▼
JSON-RPC → stdio/http transport → MCP server
    │
    ▼
server 执行，返回结果（通常是对象）
    │
    ▼
AgentTool.formatResult(output)
    │
    ├──→ 字符串：原样返回
    └──→ 对象：JSON.stringify(output, null, 2)
    │
    ▼
作为 toolResult 消息插入对话历史
```

### 3.3 命令层交互（/tools）

```
用户输入 /tools
    │
    ▼
commands/tools/tools.ts: call()
    │
    ▼
await context.session.mcpReady()
    │   └── 若 mcpInitPromise 存在则等待，否则立即返回
    ▼
读取 context.session.tools
    │   └── 已包含 MCP tools（若连接成功）
    ▼
渲染文本列表返回给用户
    │
    └── skipPrompt: true（不触发 AI 查询）
```

---

## 4. 关键设计决策

### 4.1 异步初始化，不阻塞构造函数

**决策**：AgentSession 构造函数内启动 `initializeMcpTools()`，但不 `await`。

**原因**：
- MCP 连接可能慢（子进程启动、handshake、网络延迟）
- 阻塞构造函数会拖慢 TUI 启动，用户无法立即输入
- Promise 在首次 `prompt()` 前自然完成，不影响 agent loop

**保障**：命令层通过 `mcpReady()` 显式等待，避免读到未初始化的 tools。

### 4.2 mcpReady() 暴露给命令层

**决策**：提供 `async mcpReady(): Promise<void>` 方法。

**原因**：
- `/tools` 命令需要读取完整的 tool 列表，包括 MCP tools
- 若 MCP 尚未连接完成，返回列表不完整，用户困惑
- `mcpInitPromise` 在首次 resolve 后被清空，后续调用零开销

### 4.3 stderr 统一 ignore

**决策**：`StdioClientTransport` 配置 `stderr: "ignore"`。

**原因**：
- 默认 `stderr: "inherit"` 将子进程 stderr 打印到父进程 stderr（即 TUI）
- MCP server（如 chrome-devtools-mcp）启动时会输出警告/广告信息
- 在 transport 层统一处理，对所有 server 生效，不侵入用户配置

**反模式**：修改 `.mcp.json` 传 `--no-usage-statistics` 等参数抑制输出。这是 server-specific 的 hack，不可扩展。

### 4.4 formatResult 默认 JSON.stringify

**决策**：`defineAgentTool` 默认 `formatResult`：

```typescript
formatResult: (output) => [
  {
    type: "text",
    text: typeof output === "string" ? output : JSON.stringify(output, null, 2),
  },
],
```

**原因**：
- `String({})` → `"[object Object]"`，AI 完全不可读
- MCP tool 返回的多为复杂对象（截图数据、页面列表、DOM 结构）
- JSON.stringify 让 AI 能看到实际字段，做出正确判断
- 字符串输出保持原样，避免多余引号包裹

**教训**：`[object Object]` 会导致 AI 读不到结果，反复尝试其他工具，形成无限循环。

### 4.5 skipPrompt 标记本地命令

**决策**：`local` 类型命令返回 `{ skipPrompt: true }`。

**原因**：
- `/tools`、`/help` 等命令已本地处理完毕，无需再 query 主模型
- 若遗漏 `skipPrompt`，命令执行后会继续 AI streaming，输出无意义内容
- 这是命令分发层（`commands/index.ts`）的责任，非 tool 层

---

## 5. 模块速查表

| 文件 | 职责 | 关键符号 | 何时修改 |
|------|------|----------|----------|
| `src/mcp/config.ts` | 读取 `.mcp.json`，校验，env 展开 | `loadMcpConfig()` | 新增配置字段、支持新配置来源 |
| `src/mcp/connection.ts` | 连接生命周期管理 | `McpConnectionManager` | 调整超时、新增重连逻辑 |
| `src/mcp/transport.ts` | Transport 封装 | `createMcpServerConnection()`, `BaseMcpServerConnection` | 新增 transport 类型、调整子进程行为 |
| `src/mcp/tools.ts` | MCP tool → AgentTool | `createMcpToolAdapter()` | 调整 namespacing、schema 转换 |
| `src/mcp/resources.ts` | MCP resource → AgentTool | 类似 tools.ts | 新增 resource 原语支持 |
| `src/mcp/prompts.ts` | MCP prompt → AgentTool | 类似 tools.ts | 新增 prompt 原语支持 |
| `src/mcp/utils.ts` | JSON Schema → TypeBox | `jsonSchemaToTypeBox()` | schema 转换有 bug 时 |
| `src/mcp/types.ts` | 内部类型定义 | `McpConfig`, `McpServerConfig` | 扩展配置模型 |
| `src/mcp/errors.ts` | 错误类 | `McpConnectionError`, `McpToolError` | 新增错误类型 |
| `src/agent/session.ts` | AgentSession MCP 集成 | `mcpReady()`, `initializeMcpTools()` | 调整初始化时机、生命周期 |
| `src/tui/hooks/useAgent.ts` | TUI 层传递配置 | `useAgent()`, `resetSession()` | 新增 session 配置参数 |
| `src/commands/tools/tools.ts` | /tools 命令实现 | `call()` | 调整 tool 展示逻辑 |
| `src/commands/index.ts` | 命令分发 | `executeCommand()` | 新增命令类型、调整 skipPrompt 逻辑 |
| `src/agent/define-agent-tool.ts` | AgentTool 工厂 | `defineAgentTool()` | 调整默认 formatResult、验证逻辑 |

---

## 6. 已知陷阱 & 调试指南

### 6.1 [object Object] 循环调用

**现象**：AI 调用 MCP tool 后，结果显示 `[object Object]`，然后不断尝试其他 tool。

**根因**：`defineAgentTool` 默认 `formatResult` 使用 `String(output)`，对象被序列化为 `[object Object]`。

**修复**：改为 `JSON.stringify(output, null, 2)`。

**定位**：检查 `src/agent/define-agent-tool.ts` 的默认 `formatResult`。

### 6.2 /tools 触发 AI streaming

**现象**：输入 `/tools` 后，命令结果已显示，但 AI 继续输出流式响应。

**根因**：`commands/index.ts` 中 local 命令返回 text 结果时遗漏 `skipPrompt: true`。

**修复**：确保 `executeCommand()` 返回 `{ handled: true, textResult, skipPrompt: true }`。

**定位**：检查 `src/commands/index.ts:193-199`。

### 6.3 resetSession 后 MCP 失效

**现象**：`/compact` 或手动 reset 后，MCP tools 不再出现。

**根因**：`resetSession()` 创建新 AgentSession 时未传入 `mcpConfigPath`。

**修复**：`resetSession` 中 `new AgentSession({ ..., mcpConfigPath: process.cwd() })`。

**定位**：检查 `src/tui/hooks/useAgent.ts:241-248`。

### 6.4 stderr 污染 TUI

**现象**：TUI 中反复出现 MCP server 的启动警告（如 chrome-devtools-mcp 的数据暴露提示）。

**根因**：`StdioClientTransport` 默认 `stderr: "inherit"`。

**修复**：`src/mcp/transport.ts` 中设置 `stderr: "ignore"`。

**反模式警告**：不要修改 `.mcp.json` 传 `--no-*` 参数，这不可扩展。

### 6.5 MCP 连接超时

**现象**：`/tools` 响应慢，或命令卡住。

**根因**：`McpConnectionManager` 连接超时为 10s，若 server 启动慢会等待。

**排查**：
- 检查 `.mcp.json` 配置的 command/args 是否正确
- 手动运行 command + args 验证 server 能否独立启动
- 查看 `logger.warn` 输出中的连接失败信息

---

## 7. 配置参考

### 7.1 .mcp.json 格式

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "package-name"],
      "env": { "KEY": "value" },
      "transport": "stdio"
    },
    "http-server": {
      "url": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

### 7.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `command` | string | 条件 | stdio transport 时使用 |
| `args` | string[] | 否 | 子进程参数 |
| `env` | Record<string, string> | 否 | 子进程环境变量 |
| `url` | string | 条件 | http transport 时使用 |
| `transport` | `"stdio" \| "http"` | 否 | 默认根据 `command`/`url` 推断 |

### 7.3 常用 Server 示例

**Chrome DevTools MCP**（浏览器自动化）：
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--autoConnect", "--channel=stable"]
    }
  }
}
```

**Filesystem MCP**（文件操作）：
```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"]
    }
  }
}
```

---

## 8. 扩展指南

### 8.1 新增 Transport 类型

1. 在 `src/mcp/transport.ts` 的 `createMcpServerConnection()` 中新增分支
2. 使用 MCP SDK 提供的对应 transport 类（如 `SseClientTransport`）
3. 封装为 `BaseMcpServerConnection`
4. 在 `src/mcp/types.ts` 的 `McpServerConfig` 中新增 transport 字段

### 8.2 新增 MCP 原语支持

MCP 协议未来可能扩展新原语。添加步骤：

1. 在 `src/mcp/` 下新增 `{primitive}.ts`（参考 `tools.ts` / `resources.ts` / `prompts.ts`）
2. 实现 `createMcp{Primitive}Adapter()` 函数
3. 在 `src/mcp/index.ts` 的 `loadMcpServers()` 中接入，根据 capability 检测决定是否加载
4. 在 `BaseMcpServerConnection` 中新增对应方法（若需要）

### 8.3 调试 MCP 连接

```bash
# 1. 验证配置能否读取
bun -e "const { loadMcpConfig } = require('./src/mcp/config.ts'); loadMcpConfig('.').then(console.log)"

# 2. 验证 server 能否独立启动
npx -y <package-name> <args>

# 3. 启动 TUI 后检查 /tools 输出
bun run src/main.ts --web
> /tools

# 4. 检查 agent session 的 tools 数组
# 在代码中临时加 console.log(session.tools.map(t => t.name))
```

---

## 9. 相关文档索引

| 文档 | 用途 | 路径 |
|------|------|------|
| MCP Client 集成 Spec | 设计阶段原始 spec | `docs/ys-powers/specs/2026-05-13-mcp-client-integration-design.md` |
| TUI 启用 MCP Spec | TUI 层设计 spec | `docs/ys-powers/specs/2026-05-13-enable-mcp-in-tui-design.md` |
| MCP TUI 集成 SOP | 本次实现的经验沉淀 | `sop/sop-20260513-001-mcp-tui-integration.md` |
| MCP 协议官方文档 | SDK 使用参考 | https://modelcontextprotocol.io |
