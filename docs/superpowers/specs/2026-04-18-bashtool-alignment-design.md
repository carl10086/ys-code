# BashTool 对齐 cc 设计文档

## 目标

将 BashTool 的 name、参数结构、prompt、validateInput 与 claude-code (cc) 的 BashTool 对齐。后台任务(run_in_background)和沙箱(dangerouslyDisableSandbox)一期仅预留 schema 接口，execute 中不实现或返回占位提示。

## 现状与差距

| 项 | 当前 | cc |
|---|---|---|
| 工具名 | `bash` | `Bash` |
| 参数 | `command`, `timeout`(秒) | `command`, `timeout`(毫秒), `description`, `run_in_background`, `dangerouslyDisableSandbox` |
| description | 静态短文本 | 完整使用说明（工具偏好、并行命令、git 规范、sleep 避免等） |
| validateInput | 无 | sleep 命令检测 |
| 输出 | stdout/stderr/exitCode | 扩展：interrupted, backgroundTaskId, assistantAutoBackgrounded 等 |

## 架构

```
src/agent/tools/bash.ts    # 核心实现（参数、prompt、validateInput、sleep 检测）
```

## 核心设计

### 1. 参数 schema

```typescript
const bashSchema = Type.Object({
  command: Type.String({ description: 'The command to execute' }),
  timeout: Type.Optional(Type.Number({ description: 'Optional timeout in milliseconds' })),
  description: Type.Optional(Type.String({ description: 'Clear, concise description of what the command does' })),
  run_in_background: Type.Optional(Type.Boolean({ description: 'Set to true to run this command in the background' })),
  dangerouslyDisableSandbox: Type.Optional(Type.Boolean({ description: 'Set this to true to dangerously override sandbox mode' })),
});
```

**`run_in_background` 一期行为：** 如果为 true，execute 返回提示信息 `Background tasks not yet implemented. Run the command directly without run_in_background.`

**`dangerouslyDisableSandbox` 一期行为：** 如果为 true，execute 正常执行命令（当前无沙箱，此参数无实际效果），但输出中标记 `dangerouslyDisableSandbox: true`。

### 2. Prompt（Description）

基于 cc 的 `getSimplePrompt()`，移除对不存在工具的引用（Glob/Grep/Monitor），保留以下核心部分：

```
Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run `find`, `grep`, `cat`, `head`, `tail`, `sed`, `awk`, or `echo` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)
- Communication: Output text directly (NOT echo/printf)

While the Bash tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Instructions
- If your command will create new directories or files, first use this tool to run `ls` to verify the parent directory exists and is the correct location.
- Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
- Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of `cd`. You may use `cd` if the User explicitly requests it.
- You may specify an optional timeout in milliseconds. By default, your command will timeout after 120000ms (2 minutes).
- When issuing multiple commands:
  - If the commands are independent and can run in parallel, make multiple Bash tool calls in a single message.
  - If the commands depend on each other and must run sequentially, use a single Bash call with '&&' to chain them together.
  - Use ';' only when you need to run commands sequentially but don't care if earlier commands fail.
  - DO NOT use newlines to separate commands (newlines are ok in quoted strings).
- For git commands:
  - Prefer to create a new commit rather than amending an existing commit.
  - Before running destructive operations (e.g., git reset --hard, git push --force, git checkout --), consider whether there is a safer alternative that achieves the same goal. Only use destructive operations when they are truly the best approach.
  - Never skip hooks (--no-verify) or bypass signing (--no-gpg-sign, -c commit.gpgsign=false) unless the user has explicitly asked for it. If a hook fails, investigate and fix the underlying issue.
- Avoid unnecessary `sleep` commands:
  - Do not sleep between commands that can run immediately — just run them.
  - If your command is long running and you would like to be notified when it finishes — use `run_in_background`. No sleep needed.
  - Do not retry failing commands in a sleep loop — diagnose the root cause.
  - If waiting for a background task you started with `run_in_background`, you will be notified when it completes — do not poll.
```

**说明：**
- 移除了对 `GlobTool`、`GrepTool`、`MonitorTool` 的具体引用（ys-code 尚无这些工具）
- 保留了工具偏好的通用表述（后续新增工具后可补充具体名称）
- 移除了 sandbox 相关说明（一期无沙箱）
- 保留了 git 操作规范
- timeout 默认值从 cc 的动态获取改为固定值 `120000ms`（2分钟）

### 3. validateInput — Sleep 检测

```typescript
validateInput: async (params: BashInput) => {
  // 仅当未设置 run_in_background 时检测
  if (!params.run_in_background) {
    const sleepPattern = detectBlockedSleepPattern(params.command);
    if (sleepPattern !== null) {
      return {
        ok: false,
        message: `Blocked: ${sleepPattern}. Run blocking commands in the background with run_in_background: true — you'll get a completion notification when done.`,
        errorCode: 10,
      };
    }
  }
  return { ok: true };
},
```

**`detectBlockedSleepPattern(command)` 逻辑：**
- 检测命令是否包含独立的 `sleep N`（N >= 2）
- 返回描述字符串或 null
- 简单实现：正则匹配 `^sleep\s+(\d+)` 或 `;\s*sleep\s+(\d+)`，且数字 >= 2

### 4. 输出扩展

```typescript
const bashOutputSchema = Type.Object({
  stdout: Type.String(),
  stderr: Type.String(),
  exitCode: Type.Union([Type.Number(), Type.Null()]),
  interrupted: Type.Boolean(),
  backgroundTaskId: Type.Optional(Type.String()),
  assistantAutoBackgrounded: Type.Optional(Type.Boolean()),
  dangerouslyDisableSandbox: Type.Optional(Type.Boolean()),
});
```

**一期行为：**
- `interrupted`：timeout 或 abort 导致的中断标记
- `backgroundTaskId` / `assistantAutoBackgrounded`：仅当 `run_in_background` 时填充占位值
- `dangerouslyDisableSandbox`：透传输入参数

### 5. formatResult

```typescript
formatResult: (output: BashOutput, _toolCallId: string) => {
  const parts: string[] = [];
  
  if (output.stdout) parts.push(output.stdout);
  if (output.stderr) parts.push(`stderr:\n${output.stderr}`);
  if (output.interrupted) parts.push("(command was interrupted)");
  if (output.backgroundTaskId) parts.push(`Background task started: ${output.backgroundTaskId}`);
  if (output.assistantAutoBackgrounded) parts.push("Command was auto-backgrounded after timeout.");
  
  return [{ type: "text", text: parts.join("\n") || "(no output)" }];
}
```

## 暂不对齐的项

| 项 | 原因 |
|---|---|
| `run_in_background` 完整实现 | 需要 BackgroundTaskManager 架构，二期实现 |
| `dangerouslyDisableSandbox` 实际效果 | 当前无沙箱，参数仅透传标记 |
| sandbox 说明 prompt | 当前无沙箱 |
| `Monitor` 工具引用 | ys-code 尚无此工具 |
| `Glob`/`Grep` 工具引用 | ys-code 尚无这些工具 |
| 大输出持久化 | 需要 LargeOutputHandler，二期实现 |
| 图片输出检测 | 当前无此需求 |
| `returnCodeInterpretation` | 当前无此需求 |
| `_simulatedSedEdit` | 内部字段，模型不可见 |

## 验收标准

1. `name` 为 `'Bash'`
2. 参数包含 `command`, `timeout`(毫秒), `description`, `run_in_background`, `dangerouslyDisableSandbox`
3. `description` 包含完整使用说明（工具偏好、并行命令、git 规范、sleep 避免）
4. `validateInput` 检测并阻止 sleep 命令（errorCode: 10）
5. `run_in_background` 返回占位提示，不实际后台运行
6. `bun run typecheck` 通过
7. `bun test` 通过
