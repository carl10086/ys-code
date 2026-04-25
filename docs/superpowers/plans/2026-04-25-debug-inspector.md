# Debug Inspector Web 页面实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一个进程内通过 Web 实时查看当前 AgentSession 状态，替代 `/debug` 命令的文件导出行为

**Architecture:** 引入全局 AgentSession 桥接让 Web 路由访问 React 组件内的实例；新增 `/debug` 页面和 `/api/debug/context` API；复用 Pico.css 保持 UI 一致性

**Tech Stack:** TypeScript, Bun.serve, Pico.css (CDN), 嵌入式 HTML

---

## 文件结构

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/web/debug/debug-context.ts` | 创建 | 全局 AgentSession 引用桥接 |
| `src/web/debug/debug-api.ts` | 创建 | `/api/debug/context` 路由处理器 |
| `src/web/debug/debug.html.ts` | 创建 | Debug Inspector HTML 页面 |
| `src/web/debug/debug-api.test.ts` | 创建 | API 单元测试 |
| `src/web/debug-inspector-e2e.test.ts` | 创建 | E2E 测试 |
| `src/web/routes.ts` | 修改 | 注册 `/debug` 和 `/api/debug/context` 路由 |
| `src/tui/app.tsx` | 修改 | 注册/注销 AgentSession 到桥接 |
| `src/commands/debug/debug.ts` | 修改 | 改为返回页面链接 |

---

### Task 1: 全局 AgentSession 桥接

**Files:**
- Create: `src/web/debug/debug-context.ts`

- [ ] **Step 1: 创建桥接模块**

```typescript
// src/web/debug/debug-context.ts
import type { AgentSession } from "../../agent/session.js";

let currentAgentSession: AgentSession | undefined;

/**
 * 设置当前调试用的 AgentSession
 * 由 App.tsx 在 session 创建/重置时调用
 */
export function setDebugAgentSession(session: AgentSession | undefined): void {
  currentAgentSession = session;
}

/**
 * 获取当前调试用的 AgentSession
 * 由 Debug API 路由调用
 */
export function getDebugAgentSession(): AgentSession | undefined {
  return currentAgentSession;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/debug/debug-context.ts
git commit -m "feat(debug): add global AgentSession bridge for web inspector"
```

---

### Task 2: Debug API 处理器

**Files:**
- Create: `src/web/debug/debug-api.ts`
- Modify: `src/web/debug/debug-context.ts` (无需修改，仅使用)

- [ ] **Step 1: 创建 API 处理器**

```typescript
// src/web/debug/debug-api.ts
import type { AgentMessage, AgentTool } from "../../agent/types.js";
import type { Message } from "../../core/ai/index.js";
import { getDebugAgentSession } from "./debug-context.js";

/**
 * Debug 上下文响应结构
 */
export interface DebugContextResponse {
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

/**
 * 序列化工具列表，仅保留名称和描述
 */
function serializeTools(tools: readonly AgentTool<any, any>[]): { name: string; description: string }[] {
  return tools.map((t) => ({
    name: t.name,
    description: typeof t.description === "string" ? t.description : t.description,
  }));
}

/**
 * 构建 Debug 上下文响应
 */
async function buildDebugContext(): Promise<DebugContextResponse | null> {
  const session = getDebugAgentSession();
  if (!session) {
    return null;
  }

  const messages = [...session.messages];
  const llmMessages = await session.convertToLlm(messages);

  return {
    sessionId: session.sessionId,
    model: {
      name: session.model.name,
      provider: session.model.provider,
    },
    isStreaming: session.isStreaming,
    pendingToolCalls: Array.from(session.pendingToolCalls),
    messageCount: messages.length,
    messages,
    llmMessages,
    systemPrompt: session.getSystemPrompt(),
    toolNames: session.tools.map((t) => t.name),
    timestamp: Date.now(),
  };
}

/**
 * Debug API 路由处理器
 */
export async function handleDebugAPI(req: Request): Promise<Response> {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const pathname = url.pathname;

  // GET /api/debug/context
  if (pathname === "/api/debug/context") {
    try {
      const context = await buildDebugContext();
      if (context === null) {
        return new Response(JSON.stringify({ error: "No active session" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      return Response.json(context);
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "Internal Server Error", message: String(err) }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({ error: "Not Found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/debug/debug-api.ts
git commit -m "feat(debug): add debug API handler for context inspection"
```

---

### Task 3: Debug Inspector 页面

**Files:**
- Create: `src/web/debug/debug.html.ts`

- [ ] **Step 1: 创建 HTML 页面**

```typescript
// src/web/debug/debug.html.ts

/** Debug Inspector HTML 页面 */
export const DEBUG_HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Debug Inspector - ys-code</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    body { padding: 0; margin: 0; }
    .container { max-width: 900px; margin: 0 auto; padding: 1rem; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .status-idle { background: var(--pico-ins-color); }
    .status-streaming { background: var(--pico-mark-color); }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .meta-item { margin: 0; }
    .meta-item dt { font-size: 0.75rem; color: var(--pico-muted-color); margin-bottom: 0.25rem; }
    .meta-item dd { font-size: 0.875rem; margin: 0; }
    .message-item {
      border-left: 3px solid var(--pico-muted-border-color);
      padding-left: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .message-item.user { border-left-color: var(--pico-primary); }
    .message-item.assistant { border-left-color: var(--pico-ins-color); }
    .message-item.tool { border-left-color: var(--pico-mark-color); }
    .message-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
      user-select: none;
    }
    .message-header:hover { opacity: 0.8; }
    .message-role {
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .message-summary {
      font-size: 0.8125rem;
      color: var(--pico-muted-color);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 400px;
    }
    .message-body {
      margin-top: 0.5rem;
      font-size: 0.8125rem;
    }
    .message-body pre {
      margin: 0;
      max-height: 300px;
      overflow: auto;
    }
    .empty-state {
      text-align: center;
      padding: 3rem 1rem;
      color: var(--pico-muted-color);
    }
    .timestamp {
      text-align: center;
      font-size: 0.75rem;
      color: var(--pico-muted-color);
      margin-top: 1rem;
      padding-top: 1rem;
      border-top: 1px solid var(--pico-muted-border-color);
    }
    nav[aria-label="breadcrumb"] { margin-bottom: 1rem; }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .tabs {
      display: flex;
      gap: 0.5rem;
      border-bottom: 1px solid var(--pico-muted-border-color);
      margin-bottom: 1rem;
    }
    .tab-btn {
      background: none;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 0.5rem 1rem;
      cursor: pointer;
      color: var(--pico-muted-color);
      font-size: 0.875rem;
    }
    .tab-btn.active {
      color: var(--pico-primary);
      border-bottom-color: var(--pico-primary);
    }
    .tab-btn:hover { color: var(--pico-primary); }
  </style>
</head>
<body>
  <main class="container">
    <nav aria-label="breadcrumb">
      <ul>
        <li><a href="/">Home</a></li>
        <li>Debug Inspector</li>
      </ul>
    </nav>

    <div class="header">
      <h1 style="margin:0">Debug Inspector</h1>
      <div>
        <span id="streaming-badge" class="status-badge status-idle">Idle</span>
        <button id="refresh-btn" style="margin-left:0.5rem">刷新</button>
      </div>
    </div>

    <div id="empty-state" class="empty-state" style="display:none">
      <p>无活动会话</p>
      <p style="font-size:0.875rem">请先启动一个对话</p>
    </div>

    <div id="content">
      <div class="meta-grid">
        <dl class="meta-item">
          <dt>Session ID</dt>
          <dd id="meta-session-id">-</dd>
        </dl>
        <dl class="meta-item">
          <dt>Model</dt>
          <dd id="meta-model">-</dd>
        </dl>
        <dl class="meta-item">
          <dt>Messages</dt>
          <dd id="meta-message-count">-</dd>
        </dl>
        <dl class="meta-item">
          <dt>Pending Tools</dt>
          <dd id="meta-pending">-</dd>
        </dl>
      </div>

      <div class="tabs">
        <button class="tab-btn active" data-tab="messages">Messages</button>
        <button class="tab-btn" data-tab="llm">LLM View</button>
        <button class="tab-btn" data-tab="system">System Prompt</button>
        <button class="tab-btn" data-tab="tools">Tools</button>
      </div>

      <div id="tab-messages" class="tab-content active"></div>
      <div id="tab-llm" class="tab-content"></div>
      <div id="tab-system" class="tab-content"></div>
      <div id="tab-tools" class="tab-content"></div>

      <div class="timestamp" id="timestamp">-</div>
    </div>
  </main>

  <script>
    let currentData = null;

    function formatTime(ts) {
      if (!ts) return '-';
      return new Date(ts).toLocaleString('zh-CN');
    }

    function getMessageSummary(msg) {
      if (!msg || !msg.content) return '空消息';
      if (typeof msg.content === 'string') {
        return msg.content.slice(0, 60) || '空消息';
      }
      if (Array.isArray(msg.content)) {
        const text = msg.content.filter(c => c.type === 'text').map(c => c.text).join('');
        return text.slice(0, 60) || '空消息';
      }
      return JSON.stringify(msg.content).slice(0, 60);
    }

    function renderMessageList(messages, containerId) {
      const container = document.getElementById(containerId);
      if (!messages || messages.length === 0) {
        container.innerHTML = '<p class="empty-state">无消息</p>';
        return;
      }
      container.innerHTML = messages.map((msg, i) => {
        const role = msg.role || msg.type || 'unknown';
        const summary = getMessageSummary(msg);
        return '<div class="message-item ' + role + '">' +
          '<div class="message-header" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'none\'?\'block\':\'none\'">' +
            '<span class="message-role">' + role + '</span>' +
            '<span class="message-summary">' + summary + '</span>' +
          '</div>' +
          '<div class="message-body" style="display:none">' +
            '<pre><code>' + JSON.stringify(msg, null, 2) + '</code></pre>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function renderTools(tools) {
      const container = document.getElementById('tab-tools');
      if (!tools || tools.length === 0) {
        container.innerHTML = '<p class="empty-state">无工具</p>';
        return;
      }
      container.innerHTML = '<ul>' + tools.map(t => '<li><strong>' + t + '</strong></li>').join('') + '</ul>';
    }

    async function loadData() {
      try {
        const res = await fetch('/api/debug/context');
        if (res.status === 404) {
          document.getElementById('empty-state').style.display = 'block';
          document.getElementById('content').style.display = 'none';
          return;
        }
        if (!res.ok) {
          throw new Error('HTTP ' + res.status);
        }
        const data = await res.json();
        currentData = data;

        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('content').style.display = 'block';

        // 更新元数据
        document.getElementById('meta-session-id').textContent = data.sessionId.slice(0, 8) + '...';
        document.getElementById('meta-session-id').title = data.sessionId;
        document.getElementById('meta-model').textContent = data.model.name;
        document.getElementById('meta-message-count').textContent = data.messageCount;
        document.getElementById('meta-pending').textContent = data.pendingToolCalls.length;

        // 更新状态徽章
        const badge = document.getElementById('streaming-badge');
        if (data.isStreaming) {
          badge.textContent = 'Streaming';
          badge.className = 'status-badge status-streaming';
        } else {
          badge.textContent = 'Idle';
          badge.className = 'status-badge status-idle';
        }

        // 渲染标签页
        renderMessageList(data.messages, 'tab-messages');
        renderMessageList(data.llmMessages, 'tab-llm');
        document.getElementById('tab-system').innerHTML = '<pre><code>' + (data.systemPrompt || '无') + '</code></pre>';
        renderTools(data.toolNames);

        document.getElementById('timestamp').textContent = '更新时间: ' + formatTime(data.timestamp);
      } catch (err) {
        document.getElementById('empty-state').style.display = 'block';
        document.getElementById('content').style.display = 'none';
        document.getElementById('empty-state').innerHTML = '<p>加载失败: ' + err.message + '</p>';
      }
    }

    // Tab 切换
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    // 刷新按钮
    document.getElementById('refresh-btn').addEventListener('click', loadData);

    // 初始加载
    loadData();
  </script>
</body>
</html>`;
```

- [ ] **Step 2: Commit**

```bash
git add src/web/debug/debug.html.ts
git commit -m "feat(debug): add debug inspector HTML page with Pico.css"
```

---

### Task 4: 注册路由

**Files:**
- Modify: `src/web/routes.ts`

- [ ] **Step 1: 读取现有路由文件**

已读取，当前有 `/health`, `/`, `/api/sessions`, `/sessions` 四个路由。

- [ ] **Step 2: 添加导入和路由**

在 `src/web/routes.ts` 顶部添加导入：

```typescript
import { handleDebugAPI } from "./debug/debug-api.js";
import { DEBUG_HTML } from "./debug/debug.html.js";
```

在 `buildRouter()` 函数内、返回路由器之前添加路由注册：

```typescript
  if (!routes.has("/api/debug")) {
    registerRoute("/api/debug", handleDebugAPI);
  }

  if (!routes.has("/debug")) {
    registerRoute("/debug", () => {
      return new Response(DEBUG_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
  }
```

完整修改后的 `src/web/routes.ts` 如下：

```typescript
// src/web/routes.ts
import type { RouteHandler } from "./types.js";
import { HOME_HTML } from "./pages/home.html.js";
import { handleSessionAPI, getSessionDir } from "./session-api.js";
import { SESSIONS_HTML } from "./pages/sessions.html.js";
import { handleDebugAPI } from "./debug/debug-api.js";
import { DEBUG_HTML } from "./debug/debug.html.js";

/** 路由表 */
const routes = new Map<string, RouteHandler>();

/**
 * 注册路由
 * @param path 路由路径
 * @param handler 请求处理器
 */
export function registerRoute(path: string, handler: RouteHandler): void {
  routes.set(path, handler);
}

/**
 * 构建路由器
 */
export function buildRouter(): (req: Request) => Response | Promise<Response> {
  // 注册内置路由（只注册一次）
  if (!routes.has("/health")) {
    registerRoute("/health", () => {
      return Response.json({
        status: "ok",
        service: "ys-code",
        pid: process.pid,
        timestamp: Date.now(),
        uptime: Math.floor(process.uptime()),
        sessionDir: getSessionDir(),
      });
    });
  }

  if (!routes.has("/")) {
    registerRoute("/", () => {
      return new Response(HOME_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
  }

  if (!routes.has("/api/sessions")) {
    registerRoute("/api/sessions", handleSessionAPI);
  }

  if (!routes.has("/sessions")) {
    registerRoute("/sessions", () => {
      return new Response(SESSIONS_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
  }

  if (!routes.has("/api/debug")) {
    registerRoute("/api/debug", handleDebugAPI);
  }

  if (!routes.has("/debug")) {
    registerRoute("/debug", () => {
      return new Response(DEBUG_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    });
  }

  return (request: Request): Response | Promise<Response> => {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 优先精确匹配
    const exactHandler = routes.get(pathname);
    if (exactHandler) {
      return exactHandler(request);
    }

    // 其次前缀匹配（用于 /api/sessions/:filename 和 /api/debug/context）
    for (const [routePath, handler] of routes) {
      if (pathname.startsWith(routePath + "/")) {
        return handler(request);
      }
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/web/routes.ts
git commit -m "feat(debug): register /debug and /api/debug routes"
```

---

### Task 5: App.tsx 集成

**Files:**
- Modify: `src/tui/app.tsx`

- [ ] **Step 1: 添加导入和 useEffect**

在 `src/tui/app.tsx` 顶部添加导入：

```typescript
import { setDebugAgentSession } from "../web/debug/debug-context.js";
```

在 `App` 组件内部、`useAgent` 调用之后添加 `useEffect`：

```typescript
  // 注册当前 AgentSession 到 Debug 桥接
  useEffect(() => {
    setDebugAgentSession(session);
    return () => {
      setDebugAgentSession(undefined);
    };
  }, [session]);
```

注意：`useEffect` 需要从 `react` 导入（通常已有）。

`resetSession` 会改变 `session` 引用，因此依赖数组 `[session]` 会在重置时自动更新。

- [ ] **Step 2: Commit**

```bash
git add src/tui/app.tsx
git commit -m "feat(debug): register AgentSession to debug bridge"
```

---

### Task 6: 修改 /debug 命令行为

**Files:**
- Modify: `src/commands/debug/debug.ts`

- [ ] **Step 1: 修改命令实现**

将 `src/commands/debug/debug.ts` 改为返回页面链接：

```typescript
// src/commands/debug/debug.ts
import type { LocalCommandCall } from "../../commands/types.js";

export const call: LocalCommandCall = async (_args, _context) => {
  // 获取当前 web 服务器地址
  // 由于 web 服务器可能未启动，返回固定路径
  return {
    type: "text",
    value: "Debug Inspector: http://127.0.0.1/debug\n\n提示: 需要启动时添加 --web 参数开启 Web 服务器",
  };
};
```

- [ ] **Step 2: Commit**

```bash
git add src/commands/debug/debug.ts
git commit -m "feat(debug): change /debug command to return web page link"
```

---

### Task 7: API 单元测试

**Files:**
- Create: `src/web/debug/debug-api.test.ts`

- [ ] **Step 1: 创建测试文件**

```typescript
// src/web/debug/debug-api.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { handleDebugAPI } from "./debug-api.js";
import { setDebugAgentSession } from "./debug-context.js";

// Mock AgentSession
function createMockSession(overrides: Partial<{
  sessionId: string;
  model: { name: string; provider: string };
  isStreaming: boolean;
  pendingToolCalls: Set<string>;
  messages: unknown[];
  tools: { name: string }[];
  getSystemPrompt: () => string;
  convertToLlm: (messages: unknown[]) => unknown[] | Promise<unknown[]>;
}> = {}) {
  return {
    sessionId: overrides.sessionId ?? "test-session-id",
    model: overrides.model ?? { name: "test-model", provider: "test" },
    isStreaming: overrides.isStreaming ?? false,
    pendingToolCalls: overrides.pendingToolCalls ?? new Set(),
    messages: overrides.messages ?? [],
    tools: overrides.tools ?? [],
    getSystemPrompt: overrides.getSystemPrompt ?? (() => "test system prompt"),
    convertToLlm: overrides.convertToLlm ?? ((msgs: unknown[]) => msgs),
  } as any;
}

describe("Debug API", () => {
  beforeEach(() => {
    setDebugAgentSession(undefined);
  });

  afterEach(() => {
    setDebugAgentSession(undefined);
  });

  it("should return 404 when no active session", async () => {
    const req = new Request("http://localhost/api/debug/context");
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No active session");
  });

  it("should return 405 for non-GET requests", async () => {
    const req = new Request("http://localhost/api/debug/context", { method: "POST" });
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(405);
  });

  it("should return debug context for active session", async () => {
    const session = createMockSession({
      sessionId: "sess-123",
      model: { name: "gpt-4", provider: "openai" },
      isStreaming: true,
      pendingToolCalls: new Set(["call-1"]),
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "read" }],
      convertToLlm: (msgs: unknown[]) => msgs.map((m: any) => ({ ...m, _converted: true })),
    });

    setDebugAgentSession(session);

    const req = new Request("http://localhost/api/debug/context");
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.sessionId).toBe("sess-123");
    expect(body.model.name).toBe("gpt-4");
    expect(body.isStreaming).toBe(true);
    expect(body.pendingToolCalls).toEqual(["call-1"]);
    expect(body.messageCount).toBe(1);
    expect(body.messages).toHaveLength(1);
    expect(body.llmMessages).toHaveLength(1);
    expect(body.llmMessages[0]._converted).toBe(true);
    expect(body.systemPrompt).toBe("test system prompt");
    expect(body.toolNames).toEqual(["read"]);
    expect(body.timestamp).toBeNumber();
  });

  it("should return 404 for unknown debug subpath", async () => {
    const session = createMockSession();
    setDebugAgentSession(session);

    const req = new Request("http://localhost/api/debug/unknown");
    const res = await handleDebugAPI(req);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
bun test src/web/debug/debug-api.test.ts
```

预期: 全部通过

- [ ] **Step 3: Commit**

```bash
git add src/web/debug/debug-api.test.ts
git commit -m "test(debug): add debug API unit tests"
```

---

### Task 8: E2E 测试

**Files:**
- Create: `src/web/debug-inspector-e2e.test.ts`

- [ ] **Step 1: 创建 E2E 测试**

```typescript
// src/web/debug-inspector-e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { createWebServer, stopWebServer } from "./index.js";
import { setDebugAgentSession } from "./debug/debug-context.js";

describe("Debug Inspector E2E", () => {
  beforeEach(() => {
    setDebugAgentSession(undefined);
  });

  afterEach(() => {
    stopWebServer();
    setDebugAgentSession(undefined);
  });

  it("should serve debug page", () => {
    const server = createWebServer();

    const res = fetch(`${server.url}/debug`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.text()).toContain("Debug Inspector");
  });

  it("should return 404 when no session for context API", async () => {
    const server = createWebServer();

    const res = await fetch(`${server.url}/api/debug/context`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("No active session");
  });

  it("should return context when session is registered", async () => {
    const server = createWebServer();

    const mockSession = {
      sessionId: "e2e-test-session",
      model: { name: "test-model", provider: "test" },
      isStreaming: false,
      pendingToolCalls: new Set<string>(),
      messages: [{ role: "user", content: "hi" }],
      tools: [],
      getSystemPrompt: () => "test prompt",
      convertToLlm: (msgs: unknown[]) => msgs,
    } as any;

    setDebugAgentSession(mockSession);

    const res = await fetch(`${server.url}/api/debug/context`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe("e2e-test-session");
    expect(body.messageCount).toBe(1);
  });

  it("should include debug link on home page", () => {
    const server = createWebServer();

    const res = fetch(`${server.url}/`);
    expect(res.status).toBe(200);
    const html = res.text();
    expect(html).toContain("/debug");
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
bun test src/web/debug-inspector-e2e.test.ts
```

预期: 全部通过

- [ ] **Step 3: Commit**

```bash
git add src/web/debug-inspector-e2e.test.ts
git commit -m "test(debug): add debug inspector e2e tests"
```

---

### Task 9: Home 页面添加导航链接

**Files:**
- Modify: `src/web/pages/home.html.ts`

- [ ] **Step 1: 添加 Debug Inspector 卡片**

在 `.nav-grid` 中添加第三个卡片：

```html
      <a href="/debug" class="nav-card">
        <article>
          <h3>🐛 Debug Inspector</h3>
          <p>查看当前 Agent 上下文状态</p>
        </article>
      </a>
```

同时将 grid 布局从 2 列改为自适应（已有 `grid-template-columns: 1fr 1fr`，在桌面端可以保持不变，三个卡片会自动换行；或者改为 `repeat(auto-fit, minmax(250px, 1fr))`）。

为保持简单，2 列布局下三个卡片会自动排列（2 行，第一行 2 个，第二行 1 个）。

- [ ] **Step 2: Commit**

```bash
git add src/web/pages/home.html.ts
git commit -m "feat(debug): add Debug Inspector link to home page"
```

---

## Self-Review

**1. Spec coverage:**
- [x] 全局桥接 (`debug-context.ts`) → Task 1
- [x] API 处理器 (`/api/debug/context`) → Task 2
- [x] HTML 页面 (`/debug`) → Task 3
- [x] 路由注册 → Task 4
- [x] App.tsx 集成 → Task 5
- [x] `/debug` 命令修改 → Task 6
- [x] 单元测试 → Task 7
- [x] E2E 测试 → Task 8
- [x] Home 页面链接 → Task 9

**2. Placeholder scan:** 无 TBD/TODO，每步包含完整代码

**3. Type consistency:** `DebugContextResponse` 在 Task 2 定义，Task 3 前端通过 JSON 消费，字段一致

---

## 执行选项

**Plan complete and saved to `docs/superpowers/plans/2026-04-25-debug-inspector.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints for review

**Which approach?**
