# Debug Inspector Web 页面设计

## 背景

当前 `/debug` slash 命令将 Agent 会话上下文导出为 `debug-context.json` 文件，开发者需要手动打开文件查看。本设计将 `/debug` 功能迁移到 Web 页面，提供实时、可视化的调试体验。

## 目标

- 在同一个进程内通过 Web 实时查看当前 AgentSession 状态
- 替代现有的 `/debug` 命令（保留命令入口，但行为改为打开浏览器或返回页面链接）
- 最小化实现，复用现有 Web 框架和 Pico.css 样式

## 架构

### 全局桥接

引入轻量级全局上下文桥接，让 Web 路由访问 React 组件内的 AgentSession 实例：

```typescript
// src/web/debug/debug-context.ts
let currentAgentSession: AgentSession | undefined;

export function setDebugAgentSession(session: AgentSession | undefined): void {
  currentAgentSession = session;
}

export function getDebugAgentSession(): AgentSession | undefined {
  return currentAgentSession;
}
```

`App.tsx` 在 `useAgent` 初始化后调用 `setDebugAgentSession(session)`，重置时调用 `setDebugAgentSession(undefined)`。

### 路由

| 路由 | 说明 |
|------|------|
| `GET /debug` | 返回 Debug Inspector HTML 页面 |
| `GET /api/debug/context` | 返回当前 AgentState JSON |

### API 响应结构

```typescript
interface DebugContextResponse {
  /** 会话 ID */
  sessionId: string;
  /** 模型信息 */
  model: { name: string; provider: string };
  /** 是否正在流式输出 */
  isStreaming: boolean;
  /** 待执行的工具调用 ID 列表 */
  pendingToolCalls: string[];
  /** 消息总数 */
  messageCount: number;
  /** 原始消息列表 */
  messages: AgentMessage[];
  /** 转换后的 LLM 消息 */
  llmMessages: Message[];
  /** 系统提示词 */
  systemPrompt: string;
  /** 工具名称列表 */
  toolNames: string[];
  /** 数据生成时间戳 */
  timestamp: number;
}
```

### 页面结构

使用 Pico.css 深色主题，结构与 Session Viewer 保持一致：

- **顶部栏**: sessionId（截断显示）、model 名称、isStreaming 状态指示器、刷新按钮
- **标签页**:
  - **Messages**: 原始消息列表，默认折叠，显示 role + 内容摘要，点击展开完整 JSON
  - **LLM View**: 转换后的消息列表，与 Messages 对比查看
  - **System Prompt**: 完整系统提示词，`<pre>` 块展示
  - **Tools**: 工具名称和描述列表
- **底部**: 数据生成时间戳

### 交互

- **刷新按钮**: 重新拉取 `/api/debug/context`
- **消息折叠**: 每条消息默认可折叠，只显示 role 和摘要
- **空状态**: 如果当前无 AgentSession，显示 "No active session"

## 文件结构

```
src/web/debug/
  ├── debug-api.ts       # API 路由处理器 (/api/debug/context)
  ├── debug-context.ts   # 全局 AgentSession 引用桥接
  └── debug.html.ts      # Debug Inspector 页面
```

修改文件：
- `src/tui/app.tsx`: 注册/注销 AgentSession 到全局桥接
- `src/web/routes.ts`: 注册 `/debug` 和 `/api/debug/context` 路由
- `src/commands/debug/debug.ts`: 修改行为，返回页面链接或打开浏览器

## 安全

- `/api/debug/context` 仅返回内存状态，不涉及文件系统访问
- 所有敏感信息（如 API Key）不在 AgentSession 中存储，无需过滤
- 页面仅本地可访问（`127.0.0.1`）

## 测试

- 单元测试: `debug-api.test.ts` — 测试 API 序列化逻辑
- E2E 测试: `debug-inspector-e2e.test.ts` — 测试页面加载和 API 响应
