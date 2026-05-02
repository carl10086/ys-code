# Compact 宏观设计

> 分析对象：`src/session/compact/*`, `src/commands/compact/*` @ 73baf03
> 日期：2026-05-03

---

## 概述

`/compact` 的目标是解决长会话中的上下文膨胀问题。随着编码任务推进，active messages 会包含大量用户消息、assistant 消息、工具结果和附件。继续把这些内容完整发送给模型，会浪费 token，也可能接近模型上下文上限。

compact 的做法不是删除会话历史，而是把**后续模型可见的 active context**替换成一组更小、更有结构的消息：

```text
compact_boundary
compact summary
/compact command record
local-command-stdout meta message
restored attachments
```

这样既释放上下文空间，又保留继续开发所需的任务目标、关键决策、错误修复、当前状态和最近读取文件。

---

## 本期实现范围

当前实现聚焦手动 compact：

- 用户输入 `/compact [instructions]` 主动触发。
- `/compact` 是 local command，不走普通 prompt query。
- summary 使用当前会话模型生成。
- summary 请求前先执行本地 content-clearing `microcompact`。
- compact 成功后替换内存 active messages。
- compact 后 append-only 写入 session transcript。
- restore 时从最新结构化 `compact_boundary` 恢复 active context。
- compact 失败时不替换原消息。

当前明确不包含：

- auto compact
- cached microcompact / provider cache edits
- reactive compact
- session memory compact
- 物理删除旧 transcript 历史

---

## 与 Claude Code compact 的关系

ys-code 的 compact 参考 Claude Code 的核心语义，但只实现当前项目需要的最小闭环。

保留的核心设计：

- 使用专门 summary prompt 生成结构化摘要。
- summary 作为后续上下文的一部分继续参与模型推理。
- compact 前清理旧工具结果，降低 summary 请求压力。
- compact 后重新注入关键附件，而不是完全依赖摘要记忆。
- compact boundary 作为结构锚点，标记“此前历史已被压缩”。

暂不实现的 Claude Code 能力：

- 自动阈值触发
- provider 级 cache edit
- session memory compaction
- post-compact cleanup hook 体系
- forked agent summary 路径

---

## 核心边界

compact 只改变 active context，不改变用户真实历史存在过的事实。

这带来两个重要边界：

1. **模型后续看到的是压缩后的 active messages**
   旧长历史不会继续完整进入后续 LLM payload。

2. **磁盘 transcript 仍保留历史条目**
   session 文件采用 append-only 策略，compact 不等价于隐私删除或安全擦除。

因此，compact 是上下文管理工具，不是数据清理工具。

---

## 设计原则

### 失败比污染上下文更安全

如果 summary 生成失败、compact 期间消息变化、或命令执行异常，系统应保持原 active messages 不变。不能用低质量 fallback summary 接管后续上下文。

### 命令层不拼装消息

`commands/compact` 只负责调用 `AgentSession.compact()` 并返回 compact command result。message ordering、summary、附件恢复都在 `src/session/compact/` 和 `AgentSession` 内完成。

### 安全过滤在工程代码中完成

compact summary prompt 会要求模型不要包含 secret，但真正的敏感路径过滤、内容级 secret 检测、文件权限收紧和日志脱敏都由工程代码实现。

### 恢复精确材料优先用 attachment

摘要适合保留任务语义和决策，但代码文件内容更适合作为 attachment 恢复。当前实现优先从 `FileStateCache` 的全量读取记录中恢复最近文件。
