# LLM View Debug 标记增强计划

> 基于 Spec: `docs/ys-powers/specs/2026-05-02-llm-debug-markers-design.md`

## 目标

在 Debug Inspector 的 **LLM View** 标签页中，为 `llmMessages` 增加来源标记（badge），区分：

- **Meta 消息** — `prependUserContext` 动态注入的临时上下文（`isMeta: true`）
- **Attachment 消息** — `normalizeMessages` 从 attachment 转换而来的 user 消息
- **原始消息** — 普通用户输入、assistant 回复、toolResult

**约束**：所有修改限定在 `src/web/debug/` 目录下的 `debug-api.ts` 和 `debug.html.ts`。

---

## 依赖分析

```
DebugContextResponse (debug-api.ts)
  ├── llmMessages: Message[] ──→ 扩展为 DebugLlmMessage[]
  │                                 (Message & { _debug?: { source: ... } })
  └── 由以下流程产生（只读，不修改）：
        session.messages
          → normalizeMessages()     [attachment → user, 包 <system-reminder>]
          → prependUserContext()    [头部插入 isMeta=true 的 user]
          → session.convertToLlm()  [过滤角色]

前端渲染 (debug.html.ts)
  ├── renderMessageList(containerId, messages, plain=true)
  └── 当前 plain 模式只显示 role + summary
```

**识别规则**（基于 `llmMessages` 最终状态，纯判断）：

| source | 条件 | Badge |
|--------|------|-------|
| `meta` | `role === 'user' && isMeta === true` | 📝 Meta |
| `attachment` | `role === 'user' && content 含 '<system-reminder>' && isMeta !== true` | 📎 Attach |
| `original` | 默认回退 | 无 |

---

## 任务切片（垂直）

### 任务 1：API 出口处给 llmMessages 打标记

**文件**：`src/web/debug/debug-api.ts`

**改动**：
1. 新增局部类型 `DebugLlmMessage = Message & { _debug?: { source: 'meta' \| 'attachment' \| 'original' } }`
2. 修改 `DebugContextResponse` 接口：`llmMessages` 类型从 `Message[]` 改为 `DebugLlmMessage[]`
3. 在 `buildDebugContext()` 返回前，对 `llmMessages` 做 `map`，根据规则注入 `_debug` 字段

**关键代码片段**：
```typescript
function annotateDebugSource(msg: Message): DebugLlmMessage {
  if (msg.role === 'user') {
    if (msg.isMeta === true) {
      return { ...msg, _debug: { source: 'meta' } };
    }
    if (typeof msg.content === 'string' && msg.content.includes('<system-reminder>')) {
      return { ...msg, _debug: { source: 'attachment' } };
    }
  }
  return { ...msg, _debug: { source: 'original' } };
}
```

**验收标准**：
- `bun run typecheck` 全绿
- `git diff` 确认 `src/core/ai/types.ts` 和 `src/agent/stream-assistant.ts` **零变更**
- Debug API 返回的 JSON 中，`llmMessages` 每项带 `_debug.source`

**验证步骤**：
```
1. 修改类型和 map 逻辑
2. 运行 typecheck → 通过
3. curl /api/debug/context | jq '.llmMessages[0]._debug.source' → 输出 "meta"
```

---

### 任务 2：LLM View 渲染标记

**文件**：`src/web/debug/debug.html.ts`

**改动**：
1. CSS 新增 `.llm-badge` 基础样式 + `.llm-badge.meta`（灰色）+ `.llm-badge.attach`（浅蓝色）
2. 修改 `renderMessageList` 的 `plain` 分支：读取 `msg._debug?.source`，在 role 旁渲染对应 badge
3. badge 文本硬编码：`meta` → "📝 Meta"，`attachment` → "📎 Attach"

**CSS 新增**：
```css
.llm-badge {
  display: inline-block;
  padding: 0.15rem 0.5rem;
  border-radius: 0.25rem;
  font-size: 0.75rem;
  font-weight: 600;
  margin-left: 0.5rem;
}
.llm-badge.meta { background: rgba(128,128,128,0.15); color: #888; }
.llm-badge.attach { background: rgba(74,144,226,0.15); color: #4a90e2; }
```

**plain 分支修改**：
```javascript
if (plain) {
  const summary = getMessageSummary(msg);
  let badge = '';
  if (msg._debug?.source === 'meta') {
    badge = '<span class="llm-badge meta">📝 Meta</span>';
  } else if (msg._debug?.source === 'attachment') {
    badge = '<span class="llm-badge attach">📎 Attach</span>';
  }
  // ... 原有逻辑，插入 badge
}
```

**验收标准**：
- LLM View 中 meta 消息显示 📝 Meta badge，attachment 显示 📎 Attach badge
- 原始消息不显示额外 badge
- Messages 标签页渲染不受任何影响（plain 参数隔离）

**验证步骤**：
```
1. 启动对话 session
2. 打开 Debug Inspector → LLM View
3. 确认第一条 user 消息有 📝 Meta badge
4. 确认含 <system-reminder> 的 user 消息有 📎 Attach badge
5. 切换到 Messages 标签页确认无变化
```

---

### 任务 3：集成验证与边界检查

**文件**：无需新文件

**验证内容**：
1. **端到端**：LLM View badge 与实际请求逻辑一致（meta 消息在数组头部）
2. **边界**：无 active session 时页面正常显示 404
3. **回退**：旧数据（无 `_debug`）时 plain 模式正常渲染（不加 badge）
4. **隔离确认**：`git diff --stat` 只显示 `src/web/debug/*` 文件

**验收标准**：
- 功能正常，浏览器 console 无 error
- tab 切换无样式错乱
- 只有 2 个文件被修改

---

## 检查点

| 检查点 | 条件 | 是否阻塞 |
|--------|------|---------|
| CP-1 | 任务 1 typecheck 通过 | 是 |
| CP-2 | 任务 2 前端渲染符合预期 | 是 |
| CP-3 | 任务 3 git diff 确认只改 `src/web/debug/*` | 是 |

---

## 风险与回退

| 风险 | 缓解措施 |
|------|---------|
| 误判普通 user 为 attachment | 条件要求 `isMeta !== true`，正常用户输入极少包含 `<system-reminder>` |
| 类型污染核心 Message | `_debug` 只在 `DebugLlmMessage` 扩展类型中，不修改 `Message` |
| 影响实际 LLM 请求 | `buildDebugContext` 只在 debug API 中调用，与 `stream-assistant.ts` 完全隔离 |
| XSS | badge 文本完全硬编码，不拼接任何用户内容 |

---

## 工作量估算

| 任务 | 行数 | 时间 |
|------|------|------|
| 任务 1（API 标记） | ~20 行 | 10 分钟 |
| 任务 2（前端渲染） | ~30 行 | 15 分钟 |
| 任务 3（验证） | — | 5 分钟 |
| **总计** | **~50 行** | **~30 分钟** |
