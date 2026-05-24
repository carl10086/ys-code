# ys-code 文档中心

> ys-code 项目自身的设计文档、实现指南和 API 使用参考。

---

## 文档导航

| 目录 | 内容 | 目标读者 |
|------|------|----------|
| [architecture.md](./architecture.md) | 系统架构总览 | 新成员、架构评审 |
| [specs/](./specs/) | 设计规格与方案 | 开发者、设计评审 |
| [guide/](./guide/) | 模块实现指南 | 开发者、维护者 |
| [usage/](./usage/) | API 使用手册 | 使用者、接入方 |

---

## 快速入口

### 按模块

| 模块 | 规格 | 实现指南 | 使用文档 |
|------|------|----------|----------|
| Compact | [persistence-compact.md](./specs/persistence-compact.md) | [guide/compact/](./guide/compact/) | — |
| EditTool | [read-before-write.md](./specs/read-before-write.md) | [guide/edit-tool/](./guide/edit-tool/) | — |
| Agent | [message-architecture.md](./specs/message-architecture.md) | — | [usage/agent/](./usage/agent/) |
| AI | [core-ai.md](./specs/core-ai.md) | — | [usage/ai/](./usage/ai/) |
| MCP | — | [guide/mcp/](./guide/mcp/) | — |
| Skill | [skill.md](./specs/skill.md) | — | — |
| System Prompt | [system-prompt.md](./specs/system-prompt.md) | — | — |
| Tool | [tool.md](./specs/tool.md) | — | — |

### 按主题

- **消息架构**: [specs/meta-message.md](./specs/meta-message.md) → [specs/message-architecture.md](./specs/message-architecture.md)
- **上下文压缩**: [specs/persistence-compact.md](./specs/persistence-compact.md) → [guide/compact/overview.md](./guide/compact/overview.md)
- **文件编辑**: [specs/read-before-write.md](./specs/read-before-write.md) → [guide/edit-tool/overview.md](./guide/edit-tool/overview.md)
- **TUI 渲染**: [specs/markdown-tui.md](./specs/markdown-tui.md)
- **日志系统**: [specs/logging.md](./specs/logging.md)

---

## 文档风格

- 文件名：英文 kebab-case，无日期前缀
- 技术术语：保留英文原文（如 `compact`、`tool call`）
- 代码块：使用 TypeScript 语法高亮
- 状态标注：过时内容使用 `> **状态:** 已过时` 标注

---

## 与外部参考文档的关系

| 参考来源 | 位置 | 说明 |
|----------|------|------|
| Claude Code 源码分析 | [docs/cc/](../cc/) | cc 核心机制的深度源码分析 |
| Pi-mono 参考 | `refer/pi-mono/` | 另一个 agent 项目源码 |
| Claude Code 源码 | `refer/claude-code-haha/` | 核心参考源码 |
