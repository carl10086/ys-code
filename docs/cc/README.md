# Claude Code (cc) 源码分析文档

> 本目录收录对 Claude Code（以下简称 cc）核心机制的深度源码分析，以及与 ys-code 的对比和借鉴建议。
>
> 分析基于 cc 2026 年 4 月的源码版本，路径参考 `refer/claude-code-haha/`。

---

## 目录结构

```
docs/cc/
├── README.md                    # 本文档：索引与总览
├── compact/                     # 上下文压缩系统
│   ├── overview.md              # Compact 系统完整分析
│   ├── comparison.md            # Compact 系统对比分析（cc vs pi-mono）
│   └── followup.md              # Persistence-Compact 后续问题跟踪
├── edit-tool/                   # EditTool 实现
│   ├── analysis.md              # EditTool 源码深度分析
│   └── comparison.md            # EditTool 实现对比
├── message/                     # 消息架构
│   └── architecture.md          # 消息架构分析与重构建议
├── system-prompt/               # System Prompt
│   └── analysis.md              # System Prompt 逐层分析
└── skill/                       # Skill 与 SubAgent
    ├── mechanism.md             # Skill 机制详解
    └── subagent.md              # SubAgent 实现方案
```

---

## 分析主题总览

| 主题 | 核心内容 | 与 ys-code 关联度 | 文档路径 |
|------|----------|-------------------|----------|
| **Compact** | 上下文压缩、autoCompact、microCompact、sessionMemory | 高 | `compact/` |
| **EditTool** | 文件编辑、读写检测、引用规范化、diff 生成 | 高 | `edit-tool/` |
| **Message** | 消息类型、状态机、事件流、持久化 | 高 | `message/` |
| **System Prompt** | 分层 Prompt、工具描述、动态注入 | 中 | `system-prompt/` |
| **Skill** | Skill 注册、加载、执行、自动完成 | 中 | `skill/` |

---

## 统一分析框架

每篇分析文档遵循以下结构：

1. **背景与定位** — 该机制在 cc 中的定位和价值
2. **核心原理** — 设计思想与关键概念
3. **源码实现** — 关键代码路径与执行流程
4. **与 ys-code 对比** — 表格形式对比差异
5. **可借鉴点与建议** — P0/P1/P2 优先级标注
6. **参考链接** — 源码文件路径与相关资源

---

## 阅读建议

- **新接触 cc 源码**：从 `compact/overview.md` 和 `edit-tool/analysis.md` 开始，这两个是 cc 最核心的差异化机制
- **关注 ys-code 对齐**：直接查看每篇文档第 4、5 章的对比和建议
- **快速浏览**：查看本文档上方的"分析主题总览"表格，按关联度选择阅读

---

## 说明

- 技术术语保留英文原文（如 `compact`、`tool call`、`system prompt`）
- 对比表格中 **ys-code 当前状态** 基于分析时的代码版本，可能已有更新
- 如需查看最新 cc 源码，参考本地符号链接 `refer/claude-code-haha/`
