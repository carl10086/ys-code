// src/web/pages/sessions.html.ts

/** Session Viewer 单页应用（HTML + CSS + JS 内联） */
export const SESSIONS_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ys-code Session Viewer</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    :root {
      --bg-primary: #1a1a2e;
      --bg-secondary: #16213e;
      --bg-header: #0f3460;
      --text-primary: #eeeeee;
      --text-secondary: #aaaaaa;
      --border-color: #2a2a4a;
      --accent-blue: #4a90e2;
      --accent-green: #50c878;
      --accent-yellow: #fff3cd;
      --accent-yellow-text: #856404;
      --accent-red: #e74c3c;
      --card-bg: #ffffff;
      --card-text: #333333;
      --sidebar-width: 280px;
      --header-height: 48px;
      --footer-height: 32px;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      overflow: hidden;
    }

    #app-container {
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* 顶部标题栏 */
    #app-header {
      height: var(--header-height);
      background-color: var(--bg-header);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      flex-shrink: 0;
      border-bottom: 1px solid var(--border-color);
    }

    #app-header h1 {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary);
    }

    #app-header-help {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background-color: rgba(255,255,255,0.15);
      border: none;
      color: var(--text-primary);
      cursor: pointer;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #app-header-help:hover {
      background-color: rgba(255,255,255,0.25);
    }

    /* 主体区域 */
    #app-main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* 侧边栏 */
    #app-sidebar {
      width: var(--sidebar-width);
      background-color: var(--bg-secondary);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #sidebar-content {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
    }

    .sidebar-section {
      margin-bottom: 20px;
    }

    .sidebar-title {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--text-secondary);
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }

    #back-button {
      width: 100%;
      padding: 8px 12px;
      background-color: var(--bg-header);
      color: var(--text-primary);
      border: 1px solid var(--border-color);
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
      margin-bottom: 16px;
      text-align: left;
    }

    #back-button:hover {
      background-color: rgba(255,255,255,0.1);
    }

    .session-list-item {
      padding: 10px 12px;
      border-radius: 6px;
      cursor: pointer;
      margin-bottom: 4px;
      transition: background-color 0.15s;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .session-list-item:hover {
      background-color: rgba(255,255,255,0.08);
    }

    .session-list-item.active {
      background-color: rgba(74, 144, 226, 0.2);
      border-left: 3px solid var(--accent-blue);
    }

    .session-list-item .filename {
      font-size: 13px;
      color: var(--text-primary);
      word-break: break-all;
      flex: 1;
    }

    .session-list-item .compact-icon {
      font-size: 14px;
      flex-shrink: 0;
    }

    /* 主内容区 */
    #app-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      background-color: var(--bg-primary);
    }

    #content-toolbar {
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-color);
      display: flex;
      gap: 12px;
      align-items: center;
      flex-shrink: 0;
    }

    #search-input {
      flex: 1;
      max-width: 300px;
      padding: 8px 12px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background-color: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 14px;
    }

    #search-input::placeholder {
      color: var(--text-secondary);
    }

    #filter-type, #filter-time {
      padding: 8px 12px;
      border: 1px solid var(--border-color);
      border-radius: 4px;
      background-color: var(--bg-secondary);
      color: var(--text-primary);
      font-size: 14px;
      cursor: pointer;
    }

    #content-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
    }

    /* 底部状态栏 */
    #app-footer {
      height: var(--footer-height);
      background-color: var(--bg-secondary);
      border-top: 1px solid var(--border-color);
      display: flex;
      align-items: center;
      padding: 0 20px;
      font-size: 12px;
      color: var(--text-secondary);
      flex-shrink: 0;
    }

    /* Session 列表视图 */
    .session-list-view {
      width: 100%;
    }

    .session-table {
      width: 100%;
      border-collapse: collapse;
    }

    .session-table th,
    .session-table td {
      padding: 12px 16px;
      text-align: left;
      border-bottom: 1px solid var(--border-color);
    }

    .session-table th {
      font-size: 12px;
      text-transform: uppercase;
      color: var(--text-secondary);
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .session-table tbody tr {
      cursor: pointer;
      transition: background-color 0.15s;
    }

    .session-table tbody tr:hover {
      background-color: rgba(255,255,255,0.05);
    }

    .session-table td {
      font-size: 14px;
      color: var(--text-primary);
    }

    .session-table .col-compact {
      text-align: center;
    }

    /* Session 详情视图 */
    .session-detail-view {
      max-width: 900px;
      margin: 0 auto;
    }

    .entry-card {
      background-color: var(--card-bg);
      color: var(--card-text);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 16px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
    }

    .entry-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }

    .entry-type-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 600;
      padding: 4px 10px;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .entry-timestamp {
      font-size: 12px;
      color: var(--text-secondary);
    }

    .entry-content {
      font-size: 14px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
    }

    /* 不同类型样式 */
    .entry-header-card {
      border-left: 4px solid var(--text-secondary);
    }

    .entry-header-card .entry-type-badge {
      background-color: rgba(170,170,170,0.15);
      color: #666;
    }

    .entry-user-card {
      border-left: 4px solid var(--accent-blue);
    }

    .entry-user-card .entry-type-badge {
      background-color: rgba(74, 144, 226, 0.15);
      color: var(--accent-blue);
    }

    .entry-assistant-card {
      border-left: 4px solid var(--accent-green);
    }

    .entry-assistant-card .entry-type-badge {
      background-color: rgba(80, 200, 120, 0.15);
      color: var(--accent-green);
    }

    .entry-tool-result-card {
      border-left: 4px solid #aaaaaa;
    }

    .entry-tool-result-card .entry-type-badge {
      background-color: rgba(170,170,170,0.15);
      color: #666;
    }

    .entry-compact-card {
      background-color: var(--accent-yellow);
      color: var(--accent-yellow-text);
      border-left: 4px solid #ffc107;
    }

    .entry-compact-card .entry-type-badge {
      background-color: rgba(133, 100, 4, 0.15);
      color: var(--accent-yellow-text);
    }

    .entry-compact-card .entry-content {
      color: var(--accent-yellow-text);
    }

    /* Assistant 元信息 */
    .assistant-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #eee;
      font-size: 12px;
      color: #666;
    }

    .assistant-meta-item {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .assistant-meta-label {
      font-weight: 600;
      color: #444;
    }

    /* Thinking 折叠块 */
    .thinking-block {
      margin-top: 12px;
      background-color: #f5f5f5;
      border-radius: 6px;
      overflow: hidden;
    }

    .thinking-header {
      padding: 10px 14px;
      background-color: #e8e8e8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      font-weight: 600;
      color: #555;
      user-select: none;
    }

    .thinking-header:hover {
      background-color: #ddd;
    }

    .thinking-toggle {
      font-size: 12px;
      transition: transform 0.2s;
    }

    .thinking-toggle.expanded {
      transform: rotate(180deg);
    }

    .thinking-body {
      padding: 14px;
      font-size: 13px;
      line-height: 1.6;
      color: #555;
      white-space: pre-wrap;
      display: none;
    }

    .thinking-body.expanded {
      display: block;
    }

    /* Tool call 块 */
    .tool-call-block {
      margin-top: 12px;
      background-color: #f8f8f8;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 14px;
    }

    .tool-call-name {
      font-size: 13px;
      font-weight: 600;
      color: #444;
      margin-bottom: 8px;
    }

    .tool-call-args {
      font-family: "SF Mono", Monaco, Inconsolata, "Fira Code", monospace;
      font-size: 12px;
      background-color: #f0f0f0;
      padding: 10px;
      border-radius: 4px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
      color: #333;
    }

    /* Tool result 展开 */
    .tool-result-truncated {
      position: relative;
    }

    .tool-result-truncated .truncated-mask {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 60px;
      background: linear-gradient(transparent, var(--card-bg));
      pointer-events: none;
    }

    .expand-button {
      margin-top: 8px;
      padding: 6px 12px;
      background-color: var(--bg-header);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }

    .expand-button:hover {
      background-color: #1a4a7a;
    }

    /* 空状态 */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }

    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .empty-state-text {
      font-size: 16px;
    }

    /* 加载状态 */
    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--text-secondary);
    }

    .loading-spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(255,255,255,0.1);
      border-top-color: var(--accent-blue);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* 错误状态 */
    .error-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px 20px;
      color: var(--accent-red);
    }

    .error-state-text {
      font-size: 16px;
      margin-bottom: 8px;
    }

    .error-state-detail {
      font-size: 14px;
      color: var(--text-secondary);
    }

    /* Sidebar stats */
    .sidebar-stats {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }

    .sidebar-stat-item {
      background-color: rgba(255,255,255,0.05);
      padding: 10px;
      border-radius: 6px;
      text-align: center;
    }

    .sidebar-stat-value {
      font-size: 18px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .sidebar-stat-label {
      font-size: 11px;
      color: var(--text-secondary);
      margin-top: 2px;
    }

    /* 帮助弹窗 */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0,0,0,0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .modal-content {
      background-color: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 24px;
      max-width: 500px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
    }

    .modal-title {
      font-size: 18px;
      font-weight: 600;
    }

    .modal-close {
      background: none;
      border: none;
      color: var(--text-secondary);
      font-size: 20px;
      cursor: pointer;
      padding: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
    }

    .modal-close:hover {
      background-color: rgba(255,255,255,0.1);
      color: var(--text-primary);
    }

    .modal-body {
      font-size: 14px;
      line-height: 1.6;
      color: var(--text-secondary);
    }

    .modal-body p {
      margin-bottom: 12px;
    }

    .hidden {
      display: none !important;
    }

    /* 响应式 */
    @media (max-width: 1024px) {
      #app-sidebar {
        width: 240px;
      }
    }
  </style>
</head>
<body>
  <div id="app-container">
    <!-- 顶部标题栏 -->
    <header id="app-header">
      <h1>ys-code Session Viewer</h1>
      <button id="app-header-help" title="帮助">?</button>
    </header>

    <!-- 主体区域 -->
    <div id="app-main">
      <!-- 侧边栏 -->
      <aside id="app-sidebar">
        <div id="sidebar-content">
          <!-- 动态内容 -->
        </div>
      </aside>

      <!-- 主内容区 -->
      <main id="app-content">
        <div id="content-toolbar">
          <!-- 动态工具栏 -->
        </div>
        <div id="content-body">
          <!-- 动态内容 -->
        </div>
      </main>
    </div>

    <!-- 底部状态栏 -->
    <footer id="app-footer">
      <span id="footer-text">就绪</span>
    </footer>
  </div>

  <!-- 帮助弹窗 -->
  <div id="help-modal" class="modal-overlay hidden">
    <div class="modal-content">
      <div class="modal-header">
        <h2 class="modal-title">使用帮助</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <p><strong>Session Viewer</strong> 用于查看 ys-code 的会话记录。</p>
        <p><strong>导航：</strong>点击左侧列表或主区域表格中的会话文件名查看详情。</p>
        <p><strong>搜索：</strong>在详情视图中可使用关键词搜索和类型过滤。</p>
        <p><strong>快捷键：</strong>点击条目中的折叠块可展开/收起内容。</p>
      </div>
    </div>
  </div>

  <script>
    (function() {
      'use strict';

      // 状态管理
      var state = {
        sessions: [],
        currentSession: null,
        loading: false,
        error: null,
        searchQuery: '',
        filterType: 'all',
        filterTime: 'all'
      };

      // DOM 元素引用
      var els = {
        sidebarContent: document.getElementById('sidebar-content'),
        contentToolbar: document.getElementById('content-toolbar'),
        contentBody: document.getElementById('content-body'),
        footerText: document.getElementById('footer-text'),
        helpModal: document.getElementById('help-modal'),
        helpButton: document.getElementById('app-header-help'),
        modalClose: document.querySelector('.modal-close')
      };

      // 工具函数：格式化时间
      function formatTime(timestamp) {
        if (!timestamp) return '-';
        return new Date(timestamp).toLocaleString('zh-CN');
      }

      // 工具函数：获取 entry 的 text 内容
      function getEntryText(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return content.map(function(item) {
            return item.text || item.thinking || '';
          }).join('');
        }
        return String(content);
      }

      // 工具函数：转义 HTML
      function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      // 渲染侧边栏
      function renderSidebar() {
        var hash = window.location.hash;
        var isDetail = hash.length > 2 && hash.startsWith('#/');
        var html = '';

        if (isDetail && state.currentSession) {
          // 详情视图侧边栏
          html += '<button id="back-button">&larr; 返回列表</button>';
          html += '<div class="sidebar-section">';
          html += '<div class="sidebar-title">当前会话</div>';
          html += '<div style="font-size:13px;color:var(--text-primary);margin-bottom:4px;word-break:break-all;">' + escapeHtml(state.currentSession.fileName) + '</div>';
          html += '<div style="font-size:12px;color:var(--text-secondary);">ID: ' + escapeHtml(state.currentSession.header.sessionId) + '</div>';
          html += '<div style="font-size:12px;color:var(--text-secondary);margin-top:4px;">' + formatTime(state.currentSession.header.timestamp) + '</div>';
          html += '</div>';

          if (state.currentSession.stats) {
            var stats = state.currentSession.stats;
            html += '<div class="sidebar-section">';
            html += '<div class="sidebar-title">统计</div>';
            html += '<div class="sidebar-stats">';
            html += '<div class="sidebar-stat-item"><div class="sidebar-stat-value">' + stats.userCount + '</div><div class="sidebar-stat-label">用户</div></div>';
            html += '<div class="sidebar-stat-item"><div class="sidebar-stat-value">' + stats.assistantCount + '</div><div class="sidebar-stat-label">AI</div></div>';
            html += '<div class="sidebar-stat-item"><div class="sidebar-stat-value">' + stats.toolResultCount + '</div><div class="sidebar-stat-label">工具</div></div>';
            html += '<div class="sidebar-stat-item"><div class="sidebar-stat-value">' + stats.compactCount + '</div><div class="sidebar-stat-label">压缩</div></div>';
            html += '</div>';
            html += '<div style="margin-top:12px;font-size:12px;color:var(--text-secondary);">总 Token: <span style="color:var(--text-primary);font-weight:600;">' + stats.totalTokens + '</span></div>';
            html += '</div>';
          }
        } else {
          // 列表视图侧边栏
          html += '<div class="sidebar-section">';
          html += '<div class="sidebar-title">Session 列表</div>';
          if (state.sessions.length === 0) {
            html += '<div style="font-size:13px;color:var(--text-secondary);padding:8px 0;">暂无 session 文件</div>';
          } else {
            state.sessions.forEach(function(session) {
              var activeClass = '';
              html += '<div class="session-list-item ' + activeClass + '" data-file="' + escapeHtml(session.fileName) + '">';
              html += '<span class="filename">' + escapeHtml(session.fileName) + '</span>';
              if (session.hasCompact) {
                html += '<span class="compact-icon">🗜️</span>';
              }
              html += '</div>';
            });
          }
          html += '</div>';
        }

        els.sidebarContent.innerHTML = html;

        // 绑定返回按钮事件
        var backBtn = document.getElementById('back-button');
        if (backBtn) {
          backBtn.addEventListener('click', function() {
            window.location.hash = '';
          });
        }

        // 绑定列表项点击事件
        var listItems = els.sidebarContent.querySelectorAll('.session-list-item');
        listItems.forEach(function(item) {
          item.addEventListener('click', function() {
            var file = item.getAttribute('data-file');
            if (file) {
              window.location.hash = '#/' + encodeURIComponent(file);
            }
          });
        });
      }

      // 渲染工具栏
      function renderToolbar() {
        var hash = window.location.hash;
        var isDetail = hash.length > 2 && hash.startsWith('#/');

        if (!isDetail) {
          els.contentToolbar.innerHTML = '';
          return;
        }

        var html = '';
        html += '<input type="text" id="search-input" placeholder="🔍 搜索内容..." value="' + escapeHtml(state.searchQuery) + '">';
        html += '<select id="filter-type">';
        html += '<option value="all"' + (state.filterType === 'all' ? ' selected' : '') + '>全部类型</option>';
        html += '<option value="user"' + (state.filterType === 'user' ? ' selected' : '') + '>用户</option>';
        html += '<option value="assistant"' + (state.filterType === 'assistant' ? ' selected' : '') + '>AI</option>';
        html += '<option value="toolResult"' + (state.filterType === 'toolResult' ? ' selected' : '') + '>工具结果</option>';
        html += '<option value="compact_boundary"' + (state.filterType === 'compact_boundary' ? ' selected' : '') + '>压缩</option>';
        html += '</select>';

        els.contentToolbar.innerHTML = html;

        // 绑定搜索事件
        var searchInput = document.getElementById('search-input');
        var filterType = document.getElementById('filter-type');

        if (searchInput) {
          searchInput.addEventListener('input', function(e) {
            state.searchQuery = e.target.value;
            renderContent();
          });
        }

        if (filterType) {
          filterType.addEventListener('change', function(e) {
            state.filterType = e.target.value;
            renderContent();
          });
        }
      }

      // 渲染主内容区
      function renderContent() {
        var hash = window.location.hash;
        var isDetail = hash.length > 2 && hash.startsWith('#/');

        if (state.loading) {
          els.contentBody.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><div>加载中...</div></div>';
          els.footerText.textContent = '加载中...';
          return;
        }

        if (state.error) {
          els.contentBody.innerHTML = '<div class="error-state"><div class="error-state-text">加载失败</div><div class="error-state-detail">' + escapeHtml(state.error) + '</div></div>';
          els.footerText.textContent = '错误';
          return;
        }

        if (isDetail) {
          renderSessionDetail();
        } else {
          renderSessionList();
        }
      }

      // 渲染 Session 列表
      function renderSessionList() {
        if (state.sessions.length === 0) {
          els.contentBody.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📂</div><div class="empty-state-text">暂无 session 文件</div></div>';
          els.footerText.textContent = '0 个 session';
          return;
        }

        var html = '<div class="session-list-view">';
        html += '<table class="session-table">';
        html += '<thead><tr>';
        html += '<th>文件名</th>';
        html += '<th>Session ID</th>';
        html += '<th>创建时间</th>';
        html += '<th>Entries</th>';
        html += '<th>消息数</th>';
        html += '<th class="col-compact">压缩</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        state.sessions.forEach(function(session) {
          html += '<tr data-file="' + escapeHtml(session.fileName) + '">';
          html += '<td>' + escapeHtml(session.fileName) + '</td>';
          html += '<td>' + escapeHtml(session.sessionId) + '</td>';
          html += '<td>' + formatTime(session.createdAt) + '</td>';
          html += '<td>' + session.entryCount + '</td>';
          html += '<td>' + session.messageCount + '</td>';
          html += '<td class="col-compact">' + (session.hasCompact ? '🗜️' : '') + '</td>';
          html += '</tr>';
        });

        html += '</tbody></table></div>';
        els.contentBody.innerHTML = html;

        // 更新底部状态
        var totalEntries = state.sessions.reduce(function(sum, s) { return sum + s.entryCount; }, 0);
        els.footerText.textContent = state.sessions.length + ' 个 sessions | ' + totalEntries + ' 条 entries';

        // 绑定行点击事件
        var rows = els.contentBody.querySelectorAll('tbody tr');
        rows.forEach(function(row) {
          row.addEventListener('click', function() {
            var file = row.getAttribute('data-file');
            if (file) {
              window.location.hash = '#/' + encodeURIComponent(file);
            }
          });
        });
      }

      // 渲染 Session 详情
      function renderSessionDetail() {
        if (!state.currentSession) {
          els.contentBody.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📄</div><div class="empty-state-text">未找到会话</div></div>';
          els.footerText.textContent = '未找到';
          return;
        }

        var session = state.currentSession;
        var entries = session.entries || [];

        // 前端过滤
        var filteredEntries = entries.filter(function(entry) {
          // 类型过滤
          if (state.filterType !== 'all' && entry.type !== state.filterType) {
            return false;
          }
          // 搜索过滤
          if (state.searchQuery) {
            var query = state.searchQuery.toLowerCase();
            var text = getEntryText(entry.content).toLowerCase();
            if (text.indexOf(query) === -1) {
              return false;
            }
          }
          return true;
        });

        var html = '<div class="session-detail-view">';

        if (filteredEntries.length === 0) {
          html += '<div class="empty-state"><div class="empty-state-icon">🔍</div><div class="empty-state-text">没有匹配的条目</div></div>';
        } else {
          filteredEntries.forEach(function(entry) {
            html += renderEntryCard(entry);
          });
        }

        html += '</div>';
        els.contentBody.innerHTML = html;

        // 更新底部状态
        els.footerText.textContent = '共 ' + entries.length + ' 条 entries' +
          (filteredEntries.length !== entries.length ? '（过滤后 ' + filteredEntries.length + ' 条）' : '');

        // 绑定折叠事件
        bindCollapsibleEvents();
      }

      // 渲染单个 entry 卡片
      function renderEntryCard(entry) {
        var html = '';
        var typeClass = '';
        var badgeText = '';

        switch (entry.type) {
          case 'header':
            typeClass = 'entry-header-card';
            badgeText = '系统';
            break;
          case 'user':
            typeClass = 'entry-user-card';
            badgeText = '用户';
            break;
          case 'assistant':
            typeClass = 'entry-assistant-card';
            badgeText = 'AI';
            break;
          case 'toolResult':
            typeClass = 'entry-tool-result-card';
            badgeText = '工具结果';
            break;
          case 'compact_boundary':
            typeClass = 'entry-compact-card';
            badgeText = '🗜️ Compact';
            break;
          default:
            typeClass = 'entry-header-card';
            badgeText = entry.type;
        }

        html += '<div class="entry-card ' + typeClass + '">';
        html += '<div class="entry-header">';
        html += '<span class="entry-type-badge">' + badgeText + '</span>';
        html += '<span class="entry-timestamp">' + formatTime(entry.timestamp) + '</span>';
        html += '</div>';

        // 内容渲染
        html += '<div class="entry-content">';
        html += renderEntryContent(entry);
        html += '</div>';

        // Assistant 元信息
        if (entry.type === 'assistant' && entry.model) {
          html += '<div class="assistant-meta">';
          html += '<div class="assistant-meta-item"><span class="assistant-meta-label">模型:</span> ' + escapeHtml(entry.model) + '</div>';
          if (entry.usage) {
            html += '<div class="assistant-meta-item"><span class="assistant-meta-label">Token:</span> in ' + entry.usage.input + ' / out ' + entry.usage.output + ' / total ' + entry.usage.totalTokens + '</div>';
          }
          if (entry.stopReason) {
            html += '<div class="assistant-meta-item"><span class="assistant-meta-label">停止:</span> ' + escapeHtml(entry.stopReason) + '</div>';
          }
          html += '</div>';
        }

        html += '</div>';
        return html;
      }

      // 渲染 entry 内容
      function renderEntryContent(entry) {
        if (entry.type === 'header') {
          return '<div><strong>Session:</strong> ' + escapeHtml(entry.sessionId) + '</div>' +
                 '<div><strong>CWD:</strong> ' + escapeHtml(entry.cwd) + '</div>';
        }

        if (entry.type === 'compact_boundary') {
          return '<div><strong>摘要:</strong> ' + escapeHtml(entry.summary) + '</div>' +
                 '<div style="margin-top:8px;font-size:13px;">' + entry.tokensBefore + ' → ' + entry.tokensAfter + ' tokens</div>';
        }

        if (entry.type === 'user') {
          return escapeHtml(getEntryText(entry.content));
        }

        if (entry.type === 'toolResult') {
          var text = getEntryText(entry.content);
          var isLong = text.length > 500;
          var displayText = isLong ? text.substring(0, 500) : text;
          var html = '<div style="font-weight:600;margin-bottom:8px;">工具: ' + escapeHtml(entry.toolName) + '</div>';
          if (entry.isError) {
            html += '<div style="color:var(--accent-red);margin-bottom:8px;">❌ 执行出错</div>';
          }
          html += '<div class="tool-result-text' + (isLong ? ' tool-result-truncated' : '') + '">';
          html += escapeHtml(displayText);
          if (isLong) {
            html += '<div class="truncated-mask"></div>';
            html += '</div>';
            html += '<button class="expand-button" data-full-text="' + escapeHtml(text) + '">展开全部 (' + text.length + ' 字符)</button>';
          } else {
            html += '</div>';
          }
          return html;
        }

        if (entry.type === 'assistant') {
          var html = '';
          if (Array.isArray(entry.content)) {
            entry.content.forEach(function(item) {
              if (item.type === 'text') {
                html += '<div>' + escapeHtml(item.text) + '</div>';
              } else if (item.type === 'thinking') {
                html += '<div class="thinking-block">';
                html += '<div class="thinking-header" onclick="this.classList.toggle(\'expanded\');this.nextElementSibling.classList.toggle(\'expanded\');this.querySelector(\'.thinking-toggle\').classList.toggle(\'expanded\');">';
                html += '<span>思考过程</span><span class="thinking-toggle">▼</span>';
                html += '</div>';
                html += '<div class="thinking-body">' + escapeHtml(item.thinking) + '</div>';
                html += '</div>';
              } else if (item.type === 'toolCall') {
                html += '<div class="tool-call-block">';
                html += '<div class="tool-call-name">工具: ' + escapeHtml(item.name) + '</div>';
                html += '<pre class="tool-call-args">' + escapeHtml(JSON.stringify(item.arguments, null, 2)) + '</pre>';
                html += '</div>';
              }
            });
          }
          return html;
        }

        return escapeHtml(getEntryText(entry.content));
      }

      // 绑定折叠事件
      function bindCollapsibleEvents() {
        // 工具结果展开按钮
        var expandButtons = els.contentBody.querySelectorAll('.expand-button');
        expandButtons.forEach(function(btn) {
          btn.addEventListener('click', function() {
            var fullText = btn.getAttribute('data-full-text');
            var container = btn.previousElementSibling;
            container.innerHTML = escapeHtml(fullText);
            container.classList.remove('tool-result-truncated');
            btn.style.display = 'none';
          });
        });
      }

      // 加载 Session 列表
      function loadSessions() {
        state.loading = true;
        state.error = null;
        renderContent();

        fetch('/api/sessions')
          .then(function(res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function(data) {
            state.sessions = data || [];
            state.loading = false;
            renderSidebar();
            renderContent();
          })
          .catch(function(err) {
            state.loading = false;
            state.error = err.message;
            renderContent();
          });
      }

      // 加载 Session 详情
      function loadSessionDetail(filename) {
        state.loading = true;
        state.error = null;
        state.currentSession = null;
        renderContent();
        renderSidebar();

        fetch('/api/sessions/' + encodeURIComponent(filename))
          .then(function(res) {
            if (!res.ok) {
              if (res.status === 404) throw new Error('会话不存在');
              throw new Error('HTTP ' + res.status);
            }
            return res.json();
          })
          .then(function(data) {
            state.currentSession = data;
            state.loading = false;
            renderSidebar();
            renderToolbar();
            renderContent();
          })
          .catch(function(err) {
            state.loading = false;
            state.error = err.message;
            renderSidebar();
            renderToolbar();
            renderContent();
          });
      }

      // 主渲染函数
      function render() {
        var hash = window.location.hash;
        var isDetail = hash.length > 2 && hash.startsWith('#/');

        if (isDetail) {
          var filename = decodeURIComponent(hash.slice(2));
          loadSessionDetail(filename);
        } else {
          state.currentSession = null;
          state.searchQuery = '';
          state.filterType = 'all';
          renderSidebar();
          renderToolbar();
          renderContent();
        }
      }

      // 帮助弹窗事件
      els.helpButton.addEventListener('click', function() {
        els.helpModal.classList.remove('hidden');
      });

      els.modalClose.addEventListener('click', function() {
        els.helpModal.classList.add('hidden');
      });

      els.helpModal.addEventListener('click', function(e) {
        if (e.target === els.helpModal) {
          els.helpModal.classList.add('hidden');
        }
      });

      // Hash 路由监听
      window.addEventListener('hashchange', render);

      // 初始化
      loadSessions();
      render();
    })();
  </script>
</body>
</html>`;
