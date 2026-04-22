// src/web/pages/home.html.ts

/** 极简首页 */
export const HOME_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>ys-code</title>
</head>
<body>
  <h1>ys-code web server is running</h1>
  <p>PID: <span id="pid">-</span></p>
  <script>
    fetch("/health").then(r => r.json()).then(d => {
      document.getElementById("pid").textContent = d.pid;
    });
  </script>
</body>
</html>`;
