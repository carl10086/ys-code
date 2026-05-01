---
title: "SOP: 给 Debug Inspector LLM View 增加消息来源标记"
created: 2026-05-02
tags: [feature, frontend, 2026-05-02, debug-inspector]
project: ys-code
---

## 背景

在 Debug Inspector 的 LLM View 标签页中，需要区分不同类型的 LLM 消息（meta 注入、attachment 转换、原始消息），以便开发者调试时快速识别上下文来源，排查 token 膨胀和上下文污染问题。

## 解决方案

### 伪代码步骤

1. 在 API 出口处定义扩展类型，为核心 Message 增加 `_debug` 标记字段（扩展而非修改核心类型）
2. 实现纯函数 `annotateDebugSource(msg)`，根据消息特征分类来源：
   - `role === 'user' && isMeta === true` → `meta`
   - `role === 'user' && typeof content === 'string' && content 含 '<system-reminder>'` → `attachment`
   - 其他 → `original`
3. 在 `buildDebugContext()` 返回前，对 `llmMessages` 数组做 `.map(annotateDebugSource)`
4. 前端 `renderMessageList` 的 `plain` 分支读取 `msg._debug.source`，渲染对应 badge（meta=灰色, attachment=蓝色）
5. 对 HTML 中复用的变量（如 `role`）应用 `escapeHtml()`，防止 XSS

### 关键信息

- src/web/debug/debug-api.ts
  - DebugLlmMessage（扩展类型）
  - annotateDebugSource()
  - buildDebugContext()
- src/web/debug/debug.html.ts
  - renderMessageList()
  - .llm-badge CSS classes

### 关键命令

```bash
bun run typecheck
gh pr create --title "feat(debug): ..." --body "..."
```

### 关键决策

- **在 API 出口处打标记，不动核心请求路径**：`buildDebugContext()` 只在 debug API 中调用，与 `stream-assistant.ts` 完全隔离，确保零副作用
- **扩展类型而非修改核心类型**：`DebugLlmMessage = Message & { _debug?: {...} }`，保持 `src/core/ai/types.ts` 纯净，避免污染业务类型
- **启发式识别 attachment**：通过 `content.includes("<system-reminder>")` 判断，spec 中明确接受此限制（概率极低，仅影响 debug 展示）
- **Security 优先修复预存问题**：ship review 发现 `role` 变量未 escape，虽然为 pre-existing issue，仍立即修复（`escapeHtml()` 包裹）
