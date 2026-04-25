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
