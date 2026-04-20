# Debug Context 增强设计

> **状态**: 设计评审中

## 背景

当前 debug command 导出的是 `session.messages`，但实际发给 LLM 的消息经过了多层转换：

1. `userContext` attachments prepend
2. `skill listing` injection
3. `@mention` attachments injection
4. `normalizeMessages` 展开合并
5. `convertToLlm` 转换为 LLM 格式

这导致 debug 导出的数据不是真实发给 LLM 的数据，降低了系统的可观测性。

## 目标

1. 抽取消息转换逻辑为公共内联函数（不新增文件）
2. debug command 复用该函数，导出真实 LLM 消息
3. 后续维护只需修改一处

## 设计方案

### 1. 在 `src/agent/stream-assistant.ts` 中新增内联函数

在 `streamAssistantResponse` 函数上方新增：

```typescript
/**
 * 将 AgentMessage[] 转换为最终发送给 LLM 的 Message[]
 * 包含：userContext attachments、skill listing、@mention attachments、normalize
 */
async function transformMessages(
  context: AgentContext,
  config: AgentLoopConfig,
  signal?: AbortSignal,
): Promise<Message[]> {
  let messages = context.messages;

  if (config.transformContext) {
    messages = await config.transformContext(messages, signal);
  } else if (!config.disableUserContext) {
    const userContext = await getUserContext({ cwd: process.cwd() });
    const attachments = getUserContextAttachments(userContext);
    messages = [...attachments, ...messages];
  }

  const sentSkillNames = context.sentSkillNames ?? new Set<string>();
  messages = await injectSkillListingAttachments(messages, process.cwd(), sentSkillNames);
  messages = await injectAtMentionAttachments(messages, process.cwd());

  const normalizedMessages = normalizeMessages(messages);
  return config.convertToLlm(normalizedMessages);
}
```

### 2. 重构 `streamAssistantResponse`

删除 `stream-assistant.ts` 第 102-120 行的内联逻辑（约19行），替换为：

```typescript
const llmMessages = await transformMessages(context, config, signal);
```

### 3. 更新 debug command

```typescript
import { streamAssistantResponse } from "../agent/stream-assistant.js";

export const call: LocalCommandCall = async (_args, context) => {
  const { session } = context;

  // 构建 config 用于 transformMessages
  const config = {
    convertToLlm: session.agent.convertToLlm,
    disableUserContext: false,
  };

  // 复用 streamAssistantResponse 内部逻辑获取真实 LLM 消息
  const llmMessages = await transformMessages(
    {
      messages: session.messages,
      tools: session.tools,
      sentSkillNames: session.agent.state.sentSkillNames,
    },
    config,
  );

  const debugData = {
    sessionId: session.sessionId,
    model: session.model.name,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
    systemPrompt: session.getSystemPrompt(),
    // 导出真实 LLM 消息
    llmMessages,
    // 同时保留原始 session.messages 便于对比
    rawMessages: session.messages,
  };
  // ...
};
```

注意：`transformMessages` 是 `stream-assistant.ts` 的私有函数，debug command 无法直接导入。需要通过以下方式之一解决：

**方案 A（推荐）**：将 `transformMessages` 导出，debug command 导入

**方案 B**：debug command 复制相似逻辑（不推荐，维护成本高）

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/agent/stream-assistant.ts` | 修改 | 新增 `transformMessages` 内联函数，简化 `streamAssistantResponse` |
| `src/commands/debug/debug.ts` | 修改 | 使用 `transformMessages` 导出真实 LLM 消息 |

## 验收标准

- [ ] `transformMessages` 函数正确包含所有转换步骤
- [ ] `streamAssistantResponse` 重构后行为不变
- [ ] debug command 导出的 `llmMessages` 包含 skill listing 和 @mention 内容
- [ ] 保留 `rawMessages` 便于对比原始数据
