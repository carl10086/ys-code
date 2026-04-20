# Debug Command 设计

## 概述

实现 `/debug` 命令，用于将当前会话上下文导出为 JSON 文件，保存到当前工作目录。

## 功能需求

- **命令**：`/debug`
- **输出文件**：`debug-context.json`（固定文件名，每次覆盖）
- **输出位置**：当前工作目录（cwd）

## 导出内容

导出的 JSON 包含以下字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | string | 会话 ID |
| `model` | string | 使用的模型名称 |
| `cwd` | string | 当前工作目录 |
| `timestamp` | string | 导出时间（ISO 格式） |
| `systemPrompt` | string | 系统提示文本 |
| `messages` | array | 消息列表 |

### messages 元素结构

| 字段 | 类型 | 说明 |
|------|------|------|
| `role` | string | 角色：`user` 或 `assistant` |
| `content` | string | 消息内容 |
| `timestamp` | number | 时间戳 |

## 实现方案

### 文件结构

```
src/commands/debug/
  └── index.ts    # 命令实现
```

### 实现要点

1. **命令类型**：使用 `local` 类型命令
2. **数据来源**：
   - `session.messages` 获取消息列表
   - `session.getSystemPrompt()` 获取系统提示
   - `session.model.name` 获取模型名称
   - `session.sessionId` 获取会话 ID（需在 AgentSession 中暴露）
3. **文件写入**：使用 Node.js `fs` 模块同步写入

### AgentSession 改造

需要在 `AgentSession` 中暴露 `sessionId` getter：

```typescript
get sessionId(): string {
  return this.sessionId;
}
```

## 错误处理

- 文件写入失败时，返回错误信息文本
- 覆盖已有文件时不提示，直接覆盖

## 依赖

- Node.js `fs` 模块（内置）
- Node.js `path` 模块（内置）
