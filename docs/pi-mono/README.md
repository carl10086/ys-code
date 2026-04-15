# pi-mono Coding Agent 源码分析

本目录用于存放 pi-mono `coding-agent` 模块的源码分析文档。

## 文档索引

| 文档 | 内容 |
|------|------|
| [tui-to-agent-flow.md](./tui-to-agent-flow.md) | **核心文档**：TUI → AgentSession → Agent 的完整数据流分析 |
| [coding-agent-architecture.md](./coding-agent-architecture.md) | 整体架构分层、核心组件、工具系统、Session 管理 |
| [sdk-usage.md](./sdk-usage.md) | SDK API 使用方式速查 |

## 关键洞察

pi-mono 的 coding-agent 采用 **事件驱动 + 严格分层** 的设计：

1. **TUI 层**（`InteractiveMode`）- 只负责输入捕获和渲染
2. **业务层**（`AgentSession`）- 处理命令、工具注册表、扩展、Session 持久化
3. **运行时**（`Agent` + `AgentLoop`）- LLM 调用、tool execution、hooks

所有状态变化通过 `subscribe()` 的事件流单向传递回 TUI。
