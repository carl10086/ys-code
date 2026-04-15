# 模块使用文档

> ys-code 各模块的使用参考。

## 模块列表

| 模块 | 路径 | 说明 |
|------|------|------|
| [AI](./ai/) | `src/core/ai/` | AI 抽象层，支持 MiniMax（兼容 Anthropic Messages API） |
| [Agent](./agent/) | `src/agent/` | Agent 核心模块，工具执行、状态管理、事件订阅 |

## 快速索引

**AI 模块：**
- [快速开始](./ai/README.md) - 5 分钟跑起来
- [API 参考](./ai/api-reference.md) - 所有导出函数
- [流式输出](./ai/streaming.md) - 事件流消费方式
- [Thinking](./ai/thinking.md) - reasoning 级别配置
- [Tool Call](./ai/tool-call.md) - 函数调用流程
- [费用追踪](./ai/cost-tracking.md) - Token 用量与成本计算

**Agent 模块：**
- [快速开始](./agent/README.md) - 5 分钟跑起来
- [API 参考](./agent/api-reference.md) - Agent 类所有方法
- [事件](./agent/events.md) - AgentEvent 事件类型
- [Tools](./agent/tools.md) - 定义和使用工具
- [状态管理](./agent/state.md) - state 属性详解
- [Loop](./agent/loop.md) - 低级 runAgentLoop 函数
