# ys-code TUI 最简单版本设计文档

> 将 `src/cli/chat.ts` 从 readline 模式迁移到 Ink TUI，保留所有现有 Agent 交互能力，同时增加基础的富交互体验。

---

## 目标

- 用 Ink 框架重写 CLI 聊天界面。
- 消息区域与输入框分离。
- 消息区域支持上下滚动查看历史。
- 输入框支持多行输入、Shift+Enter 换行、输入历史切换。
- 状态栏实时显示 Agent 运行状态。
- 不破坏现有 `Agent` 和 `AgentEvent` 的接口契约。

---

## 整体布局

```
┌─────────────────────────────────────┐
│  消息区域 (可滚动)                  │
│  ─────────────────────────────────  │
│  User: hello                        │
│  Assistant                          │
│  ─────────────────────────────────  │
│  Thinking: ...                      │
│  Answer: ...                        │
│  🔧 read ... OK                     │
│  ─────────────────────────────────  │
│  Tokens: 123 | Cost: $0.001 | 2.1s  │
│                                     │
│  ...                                │
├─────────────────────────────────────┤
│  > 输入框内容...                    │
│    (支持多行、Shift+Enter 换行)     │
├─────────────────────────────────────┤
│  Ready              MiniMax-M2.7    │
└─────────────────────────────────────┘
```

---

## 文件结构

```
src/tui/
  index.tsx              # 启动入口：调用 ink.render()
  app.tsx                # 根组件：布局容器 + 全局键盘监听
  hooks/
    useAgent.ts          # 封装 Agent 创建和事件订阅，转换为 UI 状态
  components/
    MessageList.tsx      # 消息列表 + 简单滚动逻辑
    MessageItem.tsx      # 单条消息渲染（user / assistant / tool）
    PromptInput.tsx      # 多行输入框 + 输入历史
    StatusBar.tsx        # 底部状态栏
```

---

## 数据流

1. `useAgent()` 在 `app.tsx` 中被调用，创建 `Agent` 实例并订阅 `AgentEvent`。
2. 事件通过 reducer 归约为 `UIMessage[]` 状态数组。
3. `MessageList` 接收 `messages`，根据 `scrollOffset` 控制可见区域。
4. `PromptInput` 管理本地输入文本和历史记录队列。
   - 提交时：若 `agent.state.isStreaming` 为 `true`，调用 `agent.steer()`；否则调用 `agent.prompt()`。
5. `StatusBar` 从 `agent.state` 读取 `isStreaming`、`pendingToolCalls` 和当前模型名称。

---

## 组件设计

### `index.tsx` — 启动入口

- 调用 `ink.render(<App />)`。
- 捕获启动错误（如 API key 缺失）并在终端打印后退出。
- 监听 `Ctrl+C` 优雅退出。

### `app.tsx` — 根组件

- 使用 `<Box flexDirection="column" height="100%">` 作为根容器。
- 上部分：`MessageList`，占据剩余高度。
- 中部分：`PromptInput`，高度根据输入行数动态变化（最小 1 行，最大 5 行）。
- 下部分：`StatusBar`，固定 1 行高度。
- 全局键盘监听：
  - `PageUp` / `PageDown`：快速滚动消息区域。
  - `↑` / `↓`：当输入框未聚焦时，逐行滚动消息区域。

### `MessageList.tsx` — 消息列表

- 使用 `<Box flexDirection="column" flexGrow={1}>` 作为外层。
- 内层使用 `<Box flexDirection="column" marginTop={-scrollOffset}>` 承载所有消息。
- 每条消息渲染为 `<MessageItem>`。
- 滚动行为：
  - 新消息到达时，若当前已滚动到底部（`scrollOffset === maxScrollOffset`），则自动跟到底部。
  - 否则保持当前滚动位置，不自动跳转。

### `MessageItem.tsx` — 单条消息

根据消息类型渲染不同样式：

| 类型 | 渲染内容 |
|------|---------|
| `user` | 前缀 `> ` + 用户输入文本 |
| `assistant_start` | `Assistant` 标题 + 分隔线 |
| `thinking_delta` | `Thinking:` 标签 + 灰色缩进文本 |
| `text_delta` | `Answer:` 标签 + 正文 |
| `tool_start` | `-> <toolName>(args)` |
| `tool_end` | `<status> <toolName> -> <summary> <time>s` |
| `assistant_end` | 分隔线 + Tokens / Cost / Time 统计 |

颜色复用 `src/cli/format.ts` 的配色逻辑（`chalk.gray`、`chalk.red` 等）。

### `PromptInput.tsx` — 多行输入框

- 状态：
  - `lines: string[]` — 当前输入的所有行。
  - `cursorLine: number` — 光标所在行索引。
  - `cursorCol: number` — 光标所在列索引。
  - `history: string[]` — 已发送消息的历史记录。
  - `historyIndex: number` — 当前在历史记录中的位置（-1 表示不在历史中）。
- 键盘行为：
  - `Enter`：提交当前输入。
  - `Shift+Enter`：在光标处插入换行。
  - `↑`：若光标在第一行，切换到上一条历史记录；否则光标上移一行。
  - `↓`：若光标在最后一行，切换到下一条历史记录；否则光标下移一行。
  - `←` / `→`：光标左右移动，支持跨行。
  - `Backspace`：删除光标前一个字符，支持跨行合并。
  - `Ctrl+C`：退出程序。
- 提交前拦截 slash 命令（`/exit`、`/new`、`/system`、`/tools`、`/messages`、`/abort`），本地处理后不进入 LLM。

### `StatusBar.tsx` — 状态栏

- 左侧：显示当前状态文本
  - `idle` → `"Ready"`
  - `streaming` → `"Streaming..."`
  - `tool_executing` → `"Executing tools..."`
- 右侧：显示当前模型名称（`agent.state.model.name`）。

### `hooks/useAgent.ts` — Agent 连接 Hook

- 接受与 `src/cli/chat.ts` 相同的初始化参数（`systemPrompt`、`model`、`tools`、`apiKey`）。
- 返回：
  - `agent: Agent` — Agent 实例。
  - `messages: UIMessage[]` — 归约后的 UI 消息列表。
  - `scrollToBottom: boolean` — 是否需要自动滚动到底部。
- 事件归约规则：
  - `turn_start` → 追加 `assistant_start` 消息。
  - `message_update` (thinking_delta) → 追加或追加到 `thinking` 消息块。
  - `message_update` (text_delta) → 追加或追加到 `text` 消息块。
  - `tool_execution_start` → 追加 `tool_start` 消息。
  - `tool_execution_end` → 追加 `tool_end` 消息。
  - `turn_end` → 追加 `assistant_end` 消息（包含 usage 和耗时）。

---

## 滚动方案

采用**简单滚动**策略：

- 所有消息完整渲染，不裁剪不可见部分。
- 通过负 `marginTop` 值移动整个消息容器，实现视觉上的滚动。
- `scrollOffset` 以**行**为单位增减。
- 最大偏移量 `maxScrollOffset = max(0, 消息总高度 - MessageList 可用高度)`。

> 选择简单滚动的理由：代码量最小，与当前 `cli/chat.ts` 的事件→追加模型最直观。在 CLI 交互场景下，单会话消息量通常不会达到需要虚拟滚动的规模。

---

## 依赖

- `ink`：TUI 框架。
- `react`：Ink 的 peer dependency。
- `chalk`：已有依赖，用于文本着色。

---

## 测试验证

1. 启动 `bun run src/tui/index.tsx`，确认界面正常渲染。
2. 发送消息，观察流式输出、thinking 灰色显示、tool 执行结果。
3. 输入多行文本（Shift+Enter 换行），确认提交后消息完整保留换行。
4. 发送消息后按 `↑`，确认能找回历史记录。
5. 在消息超出屏幕后，按 `PageUp` / `PageDown` 测试滚动。
6. 发送 `/new` 后确认历史清空。
