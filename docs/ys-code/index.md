# ys-code 文档索引

> 本文档用于生成统一的 HTML 导航页面。

---

## 架构总览

- [架构文档](./architecture.md)

## 设计规格

- [Core AI 架构](./specs/core-ai.md)
- [日志系统设计](./specs/logging.md)
- [元消息设计](./specs/meta-message.md)
- [系统提示词设计](./specs/system-prompt.md)
- [工具设计](./specs/tool.md)
- [Skill 架构](./specs/skill.md)
- [Markdown TUI 渲染](./specs/markdown-tui.md)
- [持久化与 Compact 设计](./specs/persistence-compact.md)
- [Read-Before-Write 设计](./specs/read-before-write.md)
- [消息架构重设计](./specs/message-architecture.md)

## 实现指南

### Compact

- [概述](./guide/compact/overview.md)
- [运行时链路](./guide/compact/runtime-flow.md)
- [消息模型](./guide/compact/message-model.md)
- [摘要与微压缩](./guide/compact/summary.md)
- [附件恢复](./guide/compact/attachments.md)
- [持久化与恢复](./guide/compact/persistence.md)
- [安全与失败模式](./guide/compact/safety.md)
- [测试地图](./guide/compact/testing.md)

### Edit Tool

- [执行流程](./guide/edit-tool/overview.md)
- [Read-Before-Write](./guide/edit-tool/read-before-write.md)
- [Dirty Write 检测](./guide/edit-tool/dirty-write.md)
- [引用规范化](./guide/edit-tool/quote-normalization.md)
- [文件状态缓存](./guide/edit-tool/file-state-cache.md)
- [错误处理](./guide/edit-tool/error-handling.md)
- [测试](./guide/edit-tool/testing.md)
- [与 CC 对比](./guide/edit-tool/cc-comparison.md)

### MCP

- [技术指南](./guide/mcp/technical-guide.md)

## 使用手册

### AI 模块

- [快速开始](./usage/ai/README.md)
- [API 参考](./usage/ai/api-reference.md)
- [流式输出](./usage/ai/streaming.md)
- [Thinking](./usage/ai/thinking.md)
- [Tool Call](./usage/ai/tool-call.md)
- [费用追踪](./usage/ai/cost-tracking.md)

### Agent 模块

- [快速开始](./usage/agent/README.md)
- [API 参考](./usage/agent/api-reference.md)
- [事件](./usage/agent/events.md)
- [Tools](./usage/agent/tools.md)
- [状态管理](./usage/agent/state.md)
- [Loop](./usage/agent/loop.md)
- [架构](./usage/agent/architecture.md)
