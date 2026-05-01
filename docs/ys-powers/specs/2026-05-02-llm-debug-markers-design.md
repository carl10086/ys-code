# LLM View Debug 标记增强设计

## 1. 目标 (Objective)

在 Debug Inspector 的 **LLM View** 标签页中，为每条 `llmMessages` 增加来源标记（badge），帮助开发者直观区分：

- **Meta 消息**：由 `prependUserContext` 动态注入的临时上下文（`isMeta: true`），每次请求重新生成，不持久化到 session
- **Attachment 消息**：由 `normalizeMessages` 从 `attachment` 角色转换而来的 `user` 消息，内容被 `<system-reminder>` 包裹
- **原始消息**：普通用户输入、assistant 回复、toolResult，无特殊标记

**核心价值**：调试时能一眼看出 LLM 实际收到了哪些"额外"内容，排查上下文污染、token 膨胀等问题。

---

## 2. 命令与入口 (Commands)

无新 CLI 命令或路由。入口为现有的 Debug Inspector 页面：

- 页面地址：`http://<host>:<port>/debug`
- API 端点：`GET /api/debug/context`
- 目标标签页：LLM View（`#tab-llm`）

---

## 3. 项目结构变更 (Project Structure)

仅修改两个文件，**零新增文件**：

```
src/web/debug/
  ├── debug-api.ts       # 修改：给 llmMessages 添加 _debug 标记字段
  └── debug.html.ts      # 修改：LLM View 渲染 _debug 标记为 badge
```

**不涉及**：
- `src/agent/stream-assistant.ts`（实际请求路径）
- `src/core/ai/types.ts`（核心 Message 类型）
- `src/agent/attachments/normalize.ts`
- `src/agent/context/user-context.ts`

---

## 4. 代码风格 (Code Style)

### 类型设计原则

**扩展而非修改**：核心 `Message` 类型不可变。定义局部扩展类型 `DebugLlmMessage`，仅在 debug API 的响应中使用：

```typescript
type DebugLlmMessage = Message & {
  _debug?: {
    /** 消息来源分类 */
    source: 'meta' | 'attachment' | 'original';
  };
};
```

`_debug` 前缀明确表示：这是调试专用字段，不参与业务逻辑。

### 识别逻辑

基于 `llmMessages` 的最终状态做**纯判断**，不追溯历史：

| source | 判断条件（按优先级） |
|--------|-------------------|
| `meta` | `role === 'user' && isMeta === true` |
| `attachment` | `role === 'user' && content 含 '<system-reminder>' && isMeta !== true` |
| `original` | 默认回退 |

**注意**：`isMeta` 是 `UserMessage` 的已知字段（`src/core/ai/types.ts:134`），不是新增字段。

---

## 5. 测试策略 (Testing Strategy)

### 结构验证

- `bun run typecheck` 必须全绿
- 确认 `src/core/ai/types.ts` 未被修改（git diff 校验）
- 确认 `src/agent/stream-assistant.ts` 未被修改（git diff 校验）

### 手动验证清单

1. 启动一个对话 session（触发 skill listing 或 @mention 以产生 attachment）
2. 打开 Debug Inspector，切换到 LLM View
3. 检查第一条 `user` 消息是否显示 **📝 Meta** badge
4. 检查其他含 `<system-reminder>` 的 `user` 消息是否显示 **📎 Attach** badge
5. 检查普通 `user`、`assistant`、`toolResult` 消息**不显示额外 badge**
6. 确认 Messages 标签页的渲染**未被影响**

---

## 6. 边界与约束 (Boundaries)

### 必须遵守

- **不动核心请求路径**：`stream-assistant.ts` 中的 `buildApiPayload`、`streamAssistantResponse` 等函数一行不改
- **不动核心类型**：`Message`、`UserMessage`、`AssistantMessage`、`ToolResultMessage` 的定义不增加、不修改字段
- **不引入运行时依赖**：不使用新 npm 包
- **XSS 安全**：badge 文本硬编码，不插入用户输入内容

### 已知限制

- `attachment` 的判断依赖 `<system-reminder>` 字符串匹配。如果用户正常输入包含该标签，会误判为 attachment。但这是一个可接受的启发式（概率极低，且仅为调试展示）。
- `llmMessages` 在 `convertToLlm` 后丢失了原始 `attachment` 角色信息，无法区分 `skill_listing` 和 `@mention` 的具体类型。

### 不做的事（明确排除）

- 不给 Messages 标签页增加新标记（已有之前的迭代覆盖）
- 不给 System Prompt 或 Tools 标签页增加标记
- 不在 API 中返回原始 `session.messages` 的 attachment 列表（已在 Messages 标签页可见）
- 不做持久化存储、不做服务端日志记录
