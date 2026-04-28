---
title: "SOP: 实现 Agent WebFetchTool 并防护 SSRF"
created: 2026-04-29
tags: [feature, api, 2026-04-29, ssrf, webfetch]
project: ys-code
---

## 背景

为 agent 添加远程 URL 内容抓取能力（对标 Claude Code WebFetchTool）。由于 MiniMax API 不支持原生 `web_search` 工具，需客户端自建抓取能力。核心挑战是防止 SSRF（Server-Side Request Forgery）攻击，同时提供良好的错误反馈。

## 解决方案

### 伪代码步骤

1. **定义工具契约**
   - 输入：单一 `url` 字段（string）
   - 输出：`{ url, code, codeText, bytes, result, durationMs }`
   - 标记为 `isReadOnly` 和 `isConcurrencySafe`

2. **校验输入 URL**
   - 协议白名单：仅允许 `http:` / `https:`
   - 拒绝带凭据的 URL（`user:pass@host`）
   - 拦截 localhost 及其变体（含子串匹配）
   - 拦截 IPv4 回环（127.x.x.x）和私有段（10/8, 172.16/12, 192.168/16, 169.254/16, 0.0.0.0/8）
   - 拦截 IPv6 回环（`::1`, `[::1]`, `[0:0:0:0:0:0:0:1]`）
   - 拦截 IPv6 ULA（`fc00::/7`）和 link-local（`fe80::/10`）
   - 拦截 IPv4-mapped IPv6（`::ffff:127.0.0.1` 及其 URL API 规范化后的 `::ffff:7f00:1` 形式）
   - 限制 URL 长度（2000 字符）

3. **升级与准备**
   - 若协议为 `http:`，自动升级为 `https:`
   - 若 `context.abortSignal` 已触发，立即抛错
   - 创建内部 `AbortController`，绑定外部信号和定时超时

4. **执行 fetch 并手动处理重定向**
   - 设置 `redirect: "manual"`（禁止自动跟随）
   - 发送请求，带上 `Accept: text/markdown, text/html, */*`
   - 当响应状态为 301/302/307/308 时：
     - 解析 `Location` 头，基于当前 URL  resolve 为绝对 URL
     - 用 `validateUrl` 校验新 URL
     - 若校验失败：抛业务错误 `Redirect to unsafe URL blocked`
     - 若超过最大重定向次数：终止循环
   - 读取响应为 `arrayBuffer`
   - 若内容超过 5MB：抛业务错误 `Content too large`

5. **内容处理**
   - 根据 `Content-Type` 判断：`text/html` 用 turndown 转为 Markdown，其他保留原文
   - turndown 延迟动态导入，失败时 fallback 到正则 strip tags
   - 对结果执行长度截断（默认 50KB），超限附加 `[Content truncated...]`

6. **错误分类与脱敏**
   - 定义 `WebFetchUserError` 用于业务层错误（URL 非法、重定向被拦、内容过大）
   - catch 块中：
     - `WebFetchUserError` 直接透传（用户需要知道具体原因）
     - `AbortError` 直接透传
     - 其他外部网络错误（DNS 失败、连接拒绝等）统一脱敏为 `Failed to fetch URL`
   - `finally` 中清理 timeout 和 abort 监听器

7. **格式化输出**
   - `formatResult` 返回 `[{ type: "text", text: result }]`

### 关键信息

- `src/agent/tools/webfetch.ts`
  - `createWebFetchTool()` — 工具工厂
  - `WebFetchUserError` — 业务错误标识类
  - `execute()` — 核心抓取逻辑（含重定向循环、超时、错误分类）
  - `convertHtmlToMarkdown()` — HTML→Markdown 转换

- `src/agent/tools/webfetch-utils.ts`
  - `validateUrl(url)` — SSRF 防护的 URL 校验
  - `truncateContent(content, maxLength)` — 内容截断
  - `isPrivateIp(hostname)` — 私有 IP 检测（含 IPv4-mapped IPv6 处理）
  - `extractIpv4Mapped(hostname)` — 提取 URL API 规范化后的 IPv4-mapped 地址

- `src/agent/tools/index.ts`
  - 导出 `createWebFetchTool`

### 关键命令

```bash
# 运行 WebFetchTool 相关测试
bun test ./src/agent/tools/webfetch-utils.test.ts ./src/agent/tools/webfetch.test.ts

# 完整回归测试
bun test
```

### 关键决策

- **redirect: "manual" + 逐跳验证**：Bun/Node 的 `fetch` 默认自动跟随重定向，攻击者可利用重定向跳转到内网地址绕过 URL 校验。选择手动跟随并在每跳重新校验。
- **WebFetchUserError 区分错误类型**：外部网络错误可能暴露内网拓扑（如 `getaddrinfo ENOTFOUND internal-host.corp.local`），必须脱敏；但业务错误（内容过大、重定向被拦）需要明确告知用户以便修正。
- **延迟加载 turndown**：该库体积较大，仅在遇到 HTML 时才动态导入，失败时退化到正则 strip tags，避免阻塞启动。
- **IPv4-mapped IPv6 规范化处理**：URL API 会自动将 `[::ffff:127.0.0.1]` 规范化为 `[::ffff:7f00:1]`，需要显式处理压缩后的十六进制形式，否则 SSRF 防护会漏过此类地址。
