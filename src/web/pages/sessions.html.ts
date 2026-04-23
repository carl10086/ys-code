// src/web/pages/sessions.html.ts

/** Session Viewer 单页应用（HTML + CSS + JS 内联） */
export const SESSIONS_HTML = `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ys-code Session Viewer</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    #app-container { height: 100vh; display: flex; flex-direction: column; }
    #app-header { height: 48px; display: flex; align-items: center; justify-content: space-between; padding: 0 1rem; background-color: var(--pico-card-background-color); border-bottom: 1px solid var(--pico-muted-border-color); flex-shrink: 0; }
    #app-header h1 { font-size: 1rem; margin: 0; }
    #app-main { flex: 1; display: flex; overflow: hidden; }
    #app-sidebar { width: 280px; background-color: var(--pico-card-background-color); border-right: 1px solid var(--pico-muted-border-color); display: flex; flex-direction: column; overflow: hidden; }
    #sidebar-content { flex: 1; overflow-y: auto; padding: 1rem; }
    #app-content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    #content-toolbar { padding: 0.75rem 1rem; border-bottom: 1px solid var(--pico-muted-border-color); display: flex; gap: 0.75rem; align-items: center; flex-shrink: 0; }
    #content-body { flex: 1; overflow-y: auto; padding: 1rem; }
    #app-footer { height: 32px; display: flex; align-items: center; padding: 0 1rem; font-size: 0.75rem; color: var(--pico-muted-color); background-color: var(--pico-card-background-color); border-top: 1px solid var(--pico-muted-border-color); flex-shrink: 0; }
    .session-list-item { padding: 0.5rem; border-radius: 0.25rem; cursor: pointer; margin-bottom: 0.25rem; display: flex; align-items: center; gap: 0.5rem; }
    .session-list-item:hover { background-color: rgba(128,128,128,0.15); }
    .session-list-item.active { background-color: rgba(74,144,226,0.2); border-left: 3px solid #4a90e2; }
    .session-list-item .filename { font-size: 0.8rem; word-break: break-all; flex: 1; }
    .sidebar-section { margin-bottom: 1rem; }
    .sidebar-title { font-size: 0.7rem; text-transform: uppercase; color: var(--pico-muted-color); margin-bottom: 0.5rem; letter-spacing: 0.5px; }
    .sidebar-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .sidebar-stat-item { background-color: rgba(128,128,128,0.1); padding: 0.5rem; border-radius: 0.25rem; text-align: center; }
    .sidebar-stat-value { font-size: 1.1rem; font-weight: 600; }
    .sidebar-stat-label { font-size: 0.65rem; color: var(--pico-muted-color); }
    .entry-card { margin-bottom: 1rem; padding: 1rem; border-radius: 0.5rem; background-color: var(--pico-card-background-color); }
    .entry-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
    .entry-type-badge { font-size: 0.7rem; font-weight: 600; padding: 0.25rem 0.5rem; border-radius: 0.25rem; text-transform: uppercase; letter-spacing: 0.5px; }
    .entry-timestamp { font-size: 0.75rem; color: var(--pico-muted-color); }
    .entry-content { font-size: 0.875rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
    .entry-header-card { border-left: 4px solid #aaa; }
    .entry-header-card .entry-type-badge { background-color: rgba(170,170,170,0.15); color: #aaa; }
    .entry-user-card { border-left: 4px solid #4a90e2; }
    .entry-user-card .entry-type-badge { background-color: rgba(74,144,226,0.15); color: #4a90e2; }
    .entry-assistant-card { border-left: 4px solid #50c878; }
    .entry-assistant-card .entry-type-badge { background-color: rgba(80,200,120,0.15); color: #50c878; }
    .entry-tool-result-card { border-left: 4px solid #aaa; }
    .entry-tool-result-card .entry-type-badge { background-color: rgba(170,170,170,0.15); color: #aaa; }
    .entry-compact-card { background-color: #fff3cd; color: #856404 !important; border-left: 4px solid #ffc107; }
    .entry-compact-card .entry-type-badge { background-color: rgba(133,100,4,0.15); color: #856404; }
    .entry-compact-card .entry-content { color: #856404; }
    .assistant-meta { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--pico-muted-border-color); font-size: 0.75rem; color: var(--pico-muted-color); }
    .assistant-meta-label { font-weight: 600; }
    .thinking-block, .tool-call-block { margin-top: 0.75rem; padding: 0.75rem; background-color: rgba(128,128,128,0.1); border-radius: 0.25rem; }
    .tool-call-name { font-size: 0.8rem; font-weight: 600; margin-bottom: 0.5rem; }
    .tool-call-args { font-family: monospace; font-size: 0.75rem; background-color: rgba(128,128,128,0.15); padding: 0.5rem; border-radius: 0.25rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; margin: 0; }
    .tool-result-truncated { position: relative; max-height: 120px; overflow: hidden; }
    .truncated-mask { position: absolute; bottom: 0; left: 0; right: 0; height: 60px; background: linear-gradient(transparent, var(--pico-card-background-color)); pointer-events: none; }
    .expand-button { margin-top: 0.5rem; font-size: 0.75rem; padding: 0.25rem 0.75rem; }
    .empty-state, .loading-state, .error-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 4rem 1rem; text-align: center; }
    .loading-spinner { width: 2rem; height: 2rem; border: 3px solid rgba(128,128,128,0.2); border-top-color: #4a90e2; border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 1rem; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 1000; }
    .modal-content { background-color: var(--pico-card-background-color); border: 1px solid var(--pico-muted-border-color); border-radius: 0.5rem; padding: 1.5rem; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto; }
    .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; }
    .modal-title { font-size: 1.2rem; margin: 0; }
    .modal-close { background: none; border: none; font-size: 1.5rem; cursor: pointer; padding: 0; width: 2rem; height: 2rem; display: flex; align-items: center; justify-content: center; }
    .hidden { display: none !important; }
    @media (max-width: 1024px) { #app-sidebar { width: 240px; } }
  </style>
</head>
<body>
  <div id="app-container">
    <header id="app-header">
      <h1>ys-code Session Viewer</h1>
      <button id="app-header-help" class="outline" title="帮助">?</button>
    </header>
    <div id="app-main">
      <aside id="app-sidebar">
        <div id="sidebar-content"></div>
      </aside>
      <main id="app-content">
        <div id="content-toolbar"></div>
        <div id="content-body"></div>
      </main>
    </div>
    <footer id="app-footer">
      <span id="footer-text">就绪</span>
    </footer>
  </div>

  <div id="help-modal" class="modal-overlay hidden">
    <article class="modal-content">
      <header class="modal-header">
        <h2 class="modal-title">使用帮助</h2>
        <button class="modal-close">&times;</button>
      </header>
      <div>
        <p><strong>Session Viewer</strong> 用于查看 ys-code 的会话记录。</p>
        <p><strong>导航：</strong>点击左侧列表或主区域表格中的会话文件名查看详情。</p>
        <p><strong>搜索：</strong>在详情视图中可使用关键词搜索和类型过滤。</p>
        <p><strong>快捷键：</strong>点击条目中的折叠块可展开/收起内容。</p>
      </div>
    </article>
  </div>

  <script>
    (function() {
      'use strict';

      var state = {
        sessions: [],
        currentSession: null,
        loading: false,
        error: null,
        searchQuery: '',
        filterType: 'all',
        filterTime: 'all'
      };

      var els = {
        sidebarContent: document.getElementById('sidebar-content'),
        contentToolbar: document.getElementById('content-toolbar'),
        contentBody: document.getElementById('content-body'),
        footerText: document.getElementById('footer-text'),
        helpModal: document.getElementById('help-modal'),
        helpButton: document.getElementById('app-header-help'),
        modalClose: document.querySelector('.modal-close')
      };

      function formatTime(timestamp) {
        if (!timestamp) return '-';
        return new Date(timestamp).toLocaleString('zh-CN');
      }

      function getEntryText(content) {
        if (typeof content === 'string') return content;
        if (Array.isArray(content)) {
          return content.map(function(item) {
            return item.text || item.thinking || '';
          }).join('');
        }
        return String(content);
      }

      function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }

      function renderSidebar() {
        var hash = window.location.hash;
        var isDetail = hash.length > 2 && hash.startsWith('#/');
        var html = '';

        if (isDetail && state.currentSession) {
          html += '<button id="back-button" class="secondary outline" style="width:100%;margin-bottom:1rem;">&larr; 返回列表</button>';
          html += '<div class="sidebar-section">';
          html += '<div class="sidebar-title">当前会话</div>';
          html += '<div style="font-size:0.8rem;margin-bottom:0.25rem;word-break:break-all;">' + escapeHtml(state.currentSession.fileName) + '</div>';
          html += '<div style="font-size:0.75rem;color:var(--pico-muted-color);">ID: ' + escapeHtml(state.currentSession.header.sessionId) + '</div>';
          html += '<div style="font-size:0.75rem;color:var(--pico-muted-color);margin-top:0.25rem;">' + formatTime(state.currentSession.header.timestamp) + '</div>';
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
            html += '<div style="margin-top:0.75rem;font-size:0.75rem;color:var(--pico-muted-color);">总 Token: <span style="font-weight:600;">' + stats.totalTokens + '</span></div>';
            html += '</div>';
          }
        } else {
          html += '<div class="sidebar-section">';
          html += '<div class="sidebar-title">Session 列表</div>';
          if (state.sessions.length === 0) {
            html += '<div style="font-size:0.8rem;color:var(--pico-muted-color);padding:0.5rem 0;">暂无 session 文件</div>';
          } else {
            state.sessions.forEach(function(session) {
              html += '<div class="session-list-item" data-file="' + escapeHtml(session.fileName) + '">';
              html += '<span class="filename">' + escapeHtml(session.fileName) + '</span>';
              if (session.hasCompact) {
                html += '<span>🗜️</span>';
              }
              html += '</div>';
            });
          }
          html += '</div>';
        }

        els.sidebarContent.innerHTML = html;

        var backBtn = document.getElementById('back-button');
        if (backBtn) {
          backBtn.addEventListener('click', function() {
            window.location.hash = '';
          });
        }

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

      function renderToolbar() {
        var hash = window.location.hash;
        var isDetail = hash.length > 2 && hash.startsWith('#/');

        if (!isDetail) {
          els.contentToolbar.innerHTML = '';
          return;
        }

        var html = '';
        html += '<input type="search" id="search-input" placeholder="搜索内容..." value="' + escapeHtml(state.searchQuery) + '">';
        html += '<select id="filter-type">';
        html += '<option value="all"' + (state.filterType === 'all' ? ' selected' : '') + '>全部类型</option>';
        html += '<option value="user"' + (state.filterType === 'user' ? ' selected' : '') + '>用户</option>';
        html += '<option value="assistant"' + (state.filterType === 'assistant' ? ' selected' : '') + '>AI</option>';
        html += '<option value="toolResult"' + (state.filterType === 'toolResult' ? ' selected' : '') + '>工具结果</option>';
        html += '<option value="compact_boundary"' + (state.filterType === 'compact_boundary' ? ' selected' : '') + '>压缩</option>';
        html += '</select>';

        els.contentToolbar.innerHTML = html;

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

      function renderContent() {
        var hash = window.location.hash;
        var isDetail = hash.length > 2 && hash.startsWith('#/');

        if (state.loading) {
          els.contentBody.innerHTML = '<div class="loading-state"><div class="loading-spinner"></div><div>加载中...</div></div>';
          els.footerText.textContent = '加载中...';
          return;
        }

        if (state.error) {
          els.contentBody.innerHTML = '<div class="error-state"><div style="color:var(--pico-color-red-500);font-size:1rem;margin-bottom:0.5rem;">加载失败</div><div style="color:var(--pico-muted-color);">' + escapeHtml(state.error) + '</div></div>';
          els.footerText.textContent = '错误';
          return;
        }

        if (isDetail) {
          renderSessionDetail();
        } else {
          renderSessionList();
        }
      }

      function renderSessionList() {
        if (state.sessions.length === 0) {
          els.contentBody.innerHTML = '<div class="empty-state"><div style="font-size:3rem;margin-bottom:1rem;">📂</div><div>暂无 session 文件</div></div>';
          els.footerText.textContent = '0 个 session';
          return;
        }

        var html = '<table>';
        html += '<thead><tr>';
        html += '<th>文件名</th>';
        html += '<th>Session ID</th>';
        html += '<th>创建时间</th>';
        html += '<th>Entries</th>';
        html += '<th>消息数</th>';
        html += '<th style="text-align:center;">压缩</th>';
        html += '</tr></thead>';
        html += '<tbody>';

        state.sessions.forEach(function(session) {
          html += '<tr data-file="' + escapeHtml(session.fileName) + '" style="cursor:pointer;">';
          html += '<td>' + escapeHtml(session.fileName) + '</td>';
          html += '<td>' + escapeHtml(session.sessionId) + '</td>';
          html += '<td>' + formatTime(session.createdAt) + '</td>';
          html += '<td>' + session.entryCount + '</td>';
          html += '<td>' + session.messageCount + '</td>';
          html += '<td style="text-align:center;">' + (session.hasCompact ? '🗜️' : '') + '</td>';
          html += '</tr>';
        });

        html += '</tbody></table>';
        els.contentBody.innerHTML = html;

        var totalEntries = state.sessions.reduce(function(sum, s) { return sum + s.entryCount; }, 0);
        els.footerText.textContent = state.sessions.length + ' 个 sessions | ' + totalEntries + ' 条 entries';

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

      function renderSessionDetail() {
        if (!state.currentSession) {
          els.contentBody.innerHTML = '<div class="empty-state"><div style="font-size:3rem;margin-bottom:1rem;">📄</div><div>未找到会话</div></div>';
          els.footerText.textContent = '未找到';
          return;
        }

        var session = state.currentSession;
        var entries = session.entries || [];

        var filteredEntries = entries.filter(function(entry) {
          if (state.filterType !== 'all' && entry.type !== state.filterType) {
            return false;
          }
          if (state.searchQuery) {
            var query = state.searchQuery.toLowerCase();
            var text = getEntryText(entry.content).toLowerCase();
            if (text.indexOf(query) === -1) {
              return false;
            }
          }
          return true;
        });

        var html = '<div style="max-width:900px;margin:0 auto;">';

        if (filteredEntries.length === 0) {
          html += '<div class="empty-state"><div style="font-size:3rem;margin-bottom:1rem;">🔍</div><div>没有匹配的条目</div></div>';
        } else {
          filteredEntries.forEach(function(entry) {
            html += renderEntryCard(entry);
          });
        }

        html += '</div>';
        els.contentBody.innerHTML = html;

        els.footerText.textContent = '共 ' + entries.length + ' 条 entries' +
          (filteredEntries.length !== entries.length ? '（过滤后 ' + filteredEntries.length + ' 条）' : '');

        bindCollapsibleEvents();
      }

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

        html += '<article class="entry-card ' + typeClass + '">';
        html += '<div class="entry-header">';
        html += '<span class="entry-type-badge">' + badgeText + '</span>';
        html += '<span class="entry-timestamp">' + formatTime(entry.timestamp) + '</span>';
        html += '</div>';
        html += '<div class="entry-content">';
        html += renderEntryContent(entry);
        html += '</div>';

        if (entry.type === 'assistant' && entry.model) {
          html += '<div class="assistant-meta">';
          html += '<div><span class="assistant-meta-label">模型:</span> ' + escapeHtml(entry.model) + '</div>';
          if (entry.usage) {
            html += '<div><span class="assistant-meta-label">Token:</span> in ' + entry.usage.input + ' / out ' + entry.usage.output + ' / total ' + entry.usage.totalTokens + '</div>';
          }
          if (entry.stopReason) {
            html += '<div><span class="assistant-meta-label">停止:</span> ' + escapeHtml(entry.stopReason) + '</div>';
          }
          html += '</div>';
        }

        html += '</article>';
        return html;
      }

      function renderEntryContent(entry) {
        if (entry.type === 'header') {
          return '<div><strong>Session:</strong> ' + escapeHtml(entry.sessionId) + '</div>' +
                 '<div><strong>CWD:</strong> ' + escapeHtml(entry.cwd) + '</div>';
        }

        if (entry.type === 'compact_boundary') {
          return '<div><strong>摘要:</strong> ' + escapeHtml(entry.summary) + '</div>' +
                 '<div style="margin-top:0.5rem;font-size:0.8rem;">' + entry.tokensBefore + ' → ' + entry.tokensAfter + ' tokens</div>';
        }

        if (entry.type === 'user') {
          return escapeHtml(getEntryText(entry.content));
        }

        if (entry.type === 'toolResult') {
          var text = getEntryText(entry.content);
          var isLong = text.length > 500;
          var displayText = isLong ? text.substring(0, 500) : text;
          var html = '<div style="font-weight:600;margin-bottom:0.5rem;">工具: ' + escapeHtml(entry.toolName) + '</div>';
          if (entry.isError) {
            html += '<div style="color:var(--pico-color-red-500);margin-bottom:0.5rem;">❌ 执行出错</div>';
          }
          html += '<div class="' + (isLong ? 'tool-result-truncated' : '') + '">';
          html += escapeHtml(displayText);
          if (isLong) {
            html += '<div class="truncated-mask"></div>';
            html += '</div>';
            html += '<button class="expand-button secondary" data-full-text="' + escapeHtml(text) + '">展开全部 (' + text.length + ' 字符)</button>';
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
                html += '<details>';
                html += '<summary>思考过程</summary>';
                html += '<p>' + escapeHtml(item.thinking) + '</p>';
                html += '</details>';
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

      function bindCollapsibleEvents() {
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

      window.addEventListener('hashchange', render);

      loadSessions();
      render();
    })();
  </script>
</body>
</html>`;
