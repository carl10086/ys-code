# CLI Chat 设计文档

> 一个极简的 streaming CLI，用于直接测试 `Agent` 的多轮对话、thinking、tool execution 能力。

---

## 目标

提供 `src/cli/chat.ts` 入口，让用户可以在终端里与 `ys-code` 的 `Agent` 进行多轮对话，观察流式输出（含 thinking 块）和工具执行结果。不包装 `AgentSession`，无持久化，进程退出即清空历史。

---

## 启动方式

```bash
bun run src/cli/chat.ts [可选 system prompt]
```

- 若传入参数，则作为初始 `system prompt`
- 若不传入，使用默认 system prompt（例如："You are a helpful coding assistant.")

---

## 核心配置（全部写死）

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 模型 | 从 `ys-code` 的模型注册表取默认模型 | 由 `src/core/ai/api-registry.ts` 决定 |
| thinking level | `"medium"` | 固定，不暴露修改入口 |
| 工具 | `read`, `bash`, `edit`, `write` | coding 四件套 |
| system prompt | 启动时加载，运行中只读 | 可通过 `/system` 命令查看 |

---

## Slash 命令

所有命令在本地拦截处理，不进入 LLM：

| 命令 | 行为 |
|------|------|
| `/exit` | 退出 CLI |
| `/new` | 调用 `agent.reset()` 清空对话历史 |
| `/system` | 打印当前 system prompt |
| `/tools` | 打印当前启用的工具名称列表 |
| `/messages` | 以 JSON 格式打印当前 `agent.state.messages`（调试用） |
| `/abort` | 调用 `agent.abort()` 中断当前 streaming |

---

## 输入处理

- 使用 `readline/promises` 的 `rl.question('> ')` 主循环读取输入。
- 空输入直接忽略。
- 若 Agent 正在 streaming（`agent.state.isStreaming === true`），用户新输入自动调用 `agent.steer(text)` 注入 steering 消息。
- 若 Agent 空闲，直接调用 `agent.prompt(text)`。

---

## 事件 → 输出映射

| AgentEvent | 终端表现 |
|------------|----------|
| `agent_start` | 可选不打印，或打印极小提示（如 `▶ streaming...`） |
| `agent_end` | 打印换行，恢复 `> ` 提示 |
| `text_delta` | 直接 `process.stdout.write(delta)` |
| `thinking_delta` | `chalk.gray(delta)` 直接写入 stdout，与 text 混在一起流式输出 |
| `tool_execution_start` | 换行打印 `🔧 <toolName> ...` |
| `tool_execution_update` | 不打印（仅执行中进度，CLI 忽略） |
| `tool_execution_end` | 打印结果或错误标记，若出错用 `chalk.red` 高亮 |
| `turn_end` | 打印本次 turn 的 usage（token / cost，若 API 返回可用） |

**注意**：
- thinking 块没有单独折叠逻辑，直接灰色流式输出，便于调试观察。
- tool call 参数在 `text_delta` 阶段会作为 assistant message 的 JSON 片段自然流出，无需特殊处理。

---

## 错误处理

- 模型未配置 / API key 缺失：启动时直接抛出并退出，附带清晰错误信息。
- LLM streaming 报错：由 `Agent` 内部捕获并 emit 相关事件；CLI 在 `agent_end` 后恢复输入循环。
- Tool 执行报错：通过 `tool_execution_end` 的 `isError` 标记，在终端用红色提示。

---

## 文件结构

- `src/cli/chat.ts`：唯一入口，约 150-200 行。
- 不新增 `src/cli/commands.ts` 等文件（命令太少，直接内联处理）。

---

## 测试方式

1. 启动：`bun run src/cli/chat.ts`
2. 发送消息，观察流式输出和 thinking 颜色。
3. 发送需要 tool 的任务（如 "read package.json"），观察 `🔧 read ...` 和执行结果。
4. 在 streaming 过程中输入新消息，测试 `steer` 中断注入。
5. 使用 `/new` 后发送消息，确认历史已被清空。
