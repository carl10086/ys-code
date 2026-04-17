# CLI Chat 交互体验优化设计

> 基于 `src/cli/chat.ts` 的轻量 ANSI 卡片式交互升级，保持 simple CLI 定位，不引入 TUI 依赖。

## 目标

让 `bun run src/cli/chat.ts` 的终端交互具备清晰的消息边界、流畅的流式反馈、以及直观的工具执行可视化，同时不接管全屏、不新增重量级依赖。

## 总体方案

采用**轻量 ANSI 卡片式**渲染：使用 `chalk` + 少量 ANSI escape codes，在现有 `readline` 单行输入模式基础上增强视觉层次。核心原则：
- **TTY 时增强**，非 TTY（pipe 重定向）时自动降级为纯文本
- **不引入 TUI 库**（如 `blessed`、`ink`）
- **工具执行状态实时可见**，但历史记录保持简洁

## 组件设计

### 1. 消息布局（Message Layout）

#### 用户消息
- 左侧前缀 `>`，使用 `chalk.cyan.bold`
- 正常跟随终端宽度换行，无额外边框

```
> hello
> list files in src/agent
```

#### AI 回复卡片
- 顶部边框：`┌─ Assistant ({model.name}) ─{填充线}┐`
- 内容区：正常左对齐文本
- 底部边框：`└─ Tokens: {n} | Cost: ${c} | {time}s ─{填充线}┘`
- 边框使用 `chalk.dim`，整体宽度为当前终端宽度（`process.stdout.columns`，拿不到则默认 80）
- 每次新回复前先输出一个空行，避免和上一轮挤压

```
┌─ Assistant (MiniMax-M2.7-highspeed) ─────────────────────┐
│ Hello! How can I help you today?                          │
│ I'm ready to assist with any tasks you might have.        │
└─ Tokens: 640 | Cost: $0.000218 | 0.8s ───────────────────┘
```

### 2. Thinking 与流式反馈（Thinking & Streaming）

#### Thinking 显示
- 在 AI 卡片内部以**灰色斜体缩进块**实时显示
- 使用 `chalk.gray.italic`，前面加两个空格缩进
- thinking 和正文之间**空一行**作为视觉分隔
- **全部显示**，不做折叠或截断

```
┌─ Assistant (MiniMax-M2.7-highspeed) ─────────────────────┐
│                                                           │
│   The user is greeting me. I should respond warmly       │
│   and offer assistance with any tasks they might have.   │
│                                                           │
│ Hello! How can I help you today? ▌                        │
└───────────────────────────────────────────────────────────┘
```

#### 流式光标动画
- AI 正在输出时，在最后一行末尾显示**闪烁块光标** `▌`
- 通过 `setInterval` 每 500ms 切换 `▌` / ` `（空格）
- `turn_end` 时清除光标，并补齐底部边框和元数据
- **非 TTY 环境自动禁用光标动画**
- 行尾超过终端宽度时，使用 `wrap-ansi`（已锁定依赖）自动软换行

### 3. 工具执行可视化（Tool Execution Visualization）

当 AI 调用工具时，在 AI 卡片**下方临时插入**紧凑状态行：

#### 执行中
```
  ⠋ read_file(path: "src/cli/chat.ts")
```
- 左侧旋转 spinner（字符序列：`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`），使用 `chalk.dim`
- 紧跟工具名和**展开的关键参数**（最多显示前 2 个参数，整体截断到 40 字符）

#### 执行成功
```
  ✅ read_file(path: "src/cli/chat.ts")  →  1.2KB  0.3s
```

#### 执行失败
```
  ❌ read_file(path: "src/cli/chat.ts")  →  Error: ENOENT  0.1s
```

#### 规则
- 多个工具并发/顺序执行时，每个工具独立一行，按启动顺序从上到下排列
- 所有工具完成后，状态行保留在历史中，不再更新
- 颜色：`✅` 绿色，`❌` 红色，结果摘要和时间使用 `chalk.dim`

### 4. 输入提示符行为

- 输入提示符保持 `>`，使用 `chalk.cyan.bold`
- **AI 输出期间隐藏提示符**，输出结束后再重新打印
- 收到 `agent_start` 时隐藏提示符，收到 `agent_end` 时恢复提示符

## 数据流

```
Agent Event
    │
    ├─ agent_start     → 隐藏输入提示符，准备渲染 AI 卡片顶部边框
    ├─ turn_start      → 空一行，输出顶部边框
    ├─ message_update  →
    │   ├─ thinking_delta  → 追加到 thinking 缓存，实时重绘 thinking 区块
    │   └─ text_delta      → 追加到正文缓存，实时重绘正文并更新光标位置
    ├─ tool_execution_start  → 注册新工具状态行，启动 spinner interval
    ├─ tool_execution_end    → 停止该工具 spinner，刷新为结果行（✅/❌）
    ├─ turn_end        → 清除光标，输出底部边框（Tokens | Cost | Time）
    └─ agent_end       → 恢复输入提示符
```

## 错误处理

- **终端宽度变化**：获取不到 `process.stdout.columns` 时默认 80；宽度变化不做动态重排，仅影响新输出
- **ANSI 降级**：通过 `process.stdout.isTTY` 判断，非 TTY 时禁用边框、spinner、光标动画，输出纯文本
- **光标清理**：`SIGINT` 或 `rl.close()` 前，确保清除所有未停止的 spinner 和光标，避免污染终端

## 测试策略

- **TTY 渲染测试**：通过 `FORCE_TTY=1` 环境变量强制开启渲染逻辑，验证边框和事件响应
- **Pipe 降级测试**：重定向 stdout 到非 TTY，验证无 ANSI escape codes 输出
- **工具状态测试**：模拟 `tool_execution_start` / `tool_execution_end` 序列，断言输出包含工具名和结果标记
- **光标动画测试**：mock `setInterval`，验证光标切换字符序列正确

## 文件变更

- **修改**：`src/cli/chat.ts` — 重写事件订阅和渲染逻辑，引入 `ChatRenderer` 辅助类
- **新增（可选）**：`src/cli/renderer.ts` — 如果 `chat.ts` 变得臃肿，将渲染逻辑拆分到此文件
