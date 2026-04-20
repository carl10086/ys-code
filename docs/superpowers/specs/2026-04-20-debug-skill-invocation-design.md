# Debug Skill Invocation Example 设计

> **目标**：创建一个可运行的 example，完整追踪一次 skill 调用的完整调用链。

## 背景

当前 `examples/debug-agent-chat.ts` 只演示了普通对话流程。用户想通过一路 debug 代码来理解 skill 调用的完整流程，需要一个专门的 debug example 来展示：

1. AgentSession 初始化时 skill 的加载
2. 用户输入 "执行 xxx skill" 后的完整调用链
3. SkillTool 如何找到对应 skill、获取内容、返回 newMessages
4. newMessages 如何被注入到对话上下文

## 设计方案

### 文件位置

**创建**: `examples/debug-skill-invocation.ts`

基于 `debug-agent-chat.ts` 改造，保留事件监听和格式化输出。

### 功能模块

```
1. Skill 目录扫描
   - 启动时扫描 .claude/skills 下所有 skill
   - 显示 skill 列表供用户选择

2. 完整调用链追踪
   - SkillTool.execute 被调用时的入参
   - command.getPromptForCommand() 返回的内容块
   - newMessages 的结构（meta user message）
   - 注入前后 messages.length 变化
   - contextModifier 的作用

3. Debug 日志输出
   - 每个关键环节输出带时间戳的 debug 日志
   - 用不同前缀区分不同阶段
```

### 调用链追踪点

```
用户: "执行 brainstorming skill"
    ↓
[turn_start] AgentSession.prompt() 开始
    ↓
[turn_start] refreshSystemPrompt()
    ↓
[turn_start] agent.prompt(text) 收到消息
    ↓
[turn_start] Agent 生成 ToolCall: Skill("brainstorming")
    ↓
[tool_start] SkillTool.execute 被调用
    ↓
[tool_end] SkillTool 返回 newMessages + contextModifier
    ↓
[message_update] newMessages 注入到 messages
    ↓
[turn_end] 这一轮结束，下一轮 LLM 请求带上新消息
```

### 关键 Debug 输出

```typescript
// SkillTool.execute 开始
console.debug(`[SkillTool] execute called`, { skill: params.skill, args: params.args });

// 找到对应 command
console.debug(`[SkillTool] found command`, { name: command.name, type: command.type });

// 获取 prompt 内容
console.debug(`[SkillTool] prompt content blocks`, { count: contentBlocks.length });

// 转换后的文本长度
console.debug(`[SkillTool] text content length`, { length: textContent.length });

// 创建 meta user message
console.debug(`[SkillTool] meta user message created`, { isMeta: true, contentLength: textContent.length });

// 返回结果
console.debug(`[SkillTool] returning newMessages`, { count: newMessages.length });

// tool-execution.ts 注入后
console.debug(`[tool-execution] messages after injection`, { count: messages.length });

// contextModifier 应用后
console.debug(`[tool-execution] contextModifier applied`, { finalCount: messages.length });
```

### 事件监听扩展

在 `debug-agent-chat.ts` 的事件监听基础上，增加：

```typescript
case "skill_debug": {
  console.debug(`[SkillTool]`, event.detail);
  break;
}
```

### 使用流程

```
1. 运行: bun run examples/debug-skill-invocation.ts
2. 显示: 可用 skill 列表
3. 输入: "执行 brainstorming skill"
4. 观察: 完整调用链的 debug 输出
5. 对比: 最终 LLM 响应是否基于 skill 内容
```

## 类型定义

### DebugEvent 新增

**文件**: `src/agent/session.ts`（或新增 `debug-skill-invocation.ts` 内联）

不需要修改任何现有代码，全部逻辑在 example 文件内实现。

## 测试验证

1. 启动 example，输入 "执行 brainstorming skill"
2. 确认 debug 日志按顺序输出
3. 确认 skill 内容被正确注入
4. 确认 LLM 响应反映了 skill 内容

## 技术实现

基于现有 `debug-agent-chat.ts` 改造：
- 复用 AgentSession 事件监听机制
- 复用格式化输出
- 增加 skill 扫描和 debug 日志输出
- 不修改任何 src 代码
