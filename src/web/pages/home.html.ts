// src/web/pages/home.html.ts

/** 首页 HTML */
export const HOME_HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ys-code</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    body { padding: 0; margin: 0; }
    .container { max-width: 800px; margin: 0 auto; padding: 2rem; }
    .hero { text-align: center; margin-bottom: 3rem; }
    .nav-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.5rem;
    }
    @media (max-width: 768px) {
      .nav-grid { grid-template-columns: 1fr; }
    }
    .nav-card { text-decoration: none; transition: transform 0.2s; }
    .nav-card:hover { transform: translateY(-2px); }
    .nav-card article { margin: 0; height: 100%; }
    .status-bar {
      text-align: center;
      padding: 1rem;
      border-top: 1px solid var(--pico-muted-border-color);
      font-size: 0.875rem;
      color: var(--pico-muted-color);
    }
  </style>
</head>
<body>
  <main class="container">
    <div class="hero">
      <h1>ys-code</h1>
      <p>AI-powered coding assistant</p>
    </div>
    <div class="nav-grid">
      <a href="/sessions" class="nav-card">
        <article>
          <h3>📂 Session Viewer</h3>
          <p>查看对话历史记录</p>
        </article>
      </a>
      <a href="/health" target="_blank" class="nav-card">
        <article>
          <h3>💓 Health Check</h3>
          <p>检查服务运行状态</p>
        </article>
      </a>
    </div>
  </main>
  <footer class="status-bar">
    <span id="status">加载中...</span>
  </footer>
  <script>
    fetch('/health')
      .then(r => r.json())
      .then(d => {
        document.getElementById('status').textContent =
          'PID: ' + d.pid + ' | Uptime: ' + d.uptime + 's | ' + d.service;
      })
      .catch(() => {
        document.getElementById('status').textContent = '服务状态异常';
      });
  </script>
</body>
</html>`;
