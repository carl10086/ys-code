# BashTool 对齐 cc 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 BashTool 的 name、参数结构、prompt、validateInput 与 cc 对齐，一期仅实现 prompt + 参数 + sleep 检测，后台/沙箱留空接口。

**Architecture:** 直接修改 `src/agent/tools/bash.ts` 单一文件，不引入新架构。新增 `detectBlockedSleepPattern` 辅助函数用于 validateInput。

**Tech Stack:** TypeScript, Bun, TypeBox, @sinclair/typebox

---

### Task 1: 扩展参数 schema 和输出 schema

**Files:**
- Modify: `src/agent/tools/bash.ts:7-16`

- [ ] **Step 1: 将 `bashSchema` 替换为 cc 对齐版本**

```typescript
const bashSchema = Type.Object({
  command: Type.String({ description: "The command to execute" }),
  timeout: Type.Optional(Type.Number({ description: "Optional timeout in milliseconds" })),
  description: Type.Optional(Type.String({ description: "Clear, concise description of what the command does" })),
  run_in_background: Type.Optional(Type.Boolean({ description: "Set to true to run this command in the background" })),
  dangerouslyDisableSandbox: Type.Optional(Type.Boolean({ description: "Set this to true to dangerously override sandbox mode" })),
});
```

- [ ] **Step 2: 将 `bashOutputSchema` 替换为扩展版本**

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

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/bash.ts
git commit -m "refactor(bash): align parameter and output schema with cc"
```

---

### Task 2: 修改工具定义 — name、description、validateInput

**Files:**
- Modify: `src/agent/tools/bash.ts:21-67`

- [ ] **Step 1: 替换 `createBashTool` 完整函数体**

```typescript
export function createBashTool(cwd: string): AgentTool<typeof bashSchema, BashOutput> {
  return defineAgentTool({
    name: "Bash",
    label: "Bash",
    description: `Executes a given bash command and returns its output.

The working directory persists between commands, but shell state does not. The shell environment is initialized from the user's profile (bash or zsh).

IMPORTANT: Avoid using this tool to run \`find\`, \`grep\`, \`cat\`, \`head\`, \`tail\`, \`sed\`, \`awk\`, or \`echo\` commands, unless explicitly instructed or after you have verified that a dedicated tool cannot accomplish your task. Instead, use the appropriate dedicated tool as this will provide a much better experience for the user:

- File search: Use Glob (NOT find or ls)
- Content search: Use Grep (NOT grep or rg)
- Read files: Use Read (NOT cat/head/tail)
- Edit files: Use Edit (NOT sed/awk)
- Write files: Use Write (NOT echo >/cat <<EOF)
- Communication: Output text directly (NOT echo/printf)

While the Bash tool can do similar things, it's better to use the built-in tools as they provide a better user experience and make it easier to review tool calls and give permission.

# Instructions
- If your command will create new directories or files, first use this tool to run \`ls\` to verify the parent directory exists and is the correct location.
- Always quote file paths that contain spaces with double quotes in your command (e.g., cd "path with spaces/file.txt")
- Try to maintain your current working directory throughout the session by using absolute paths and avoiding usage of \`cd\`. You may use \`cd\` if the User explicitly requests it.
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
- Avoid unnecessary \`sleep\` commands:
  - Do not sleep between commands that can run immediately — just run them.
  - If your command is long running and you would like to be notified when it finishes — use \`run_in_background\`. No sleep needed.
  - Do not retry failing commands in a sleep loop — diagnose the root cause.
  - If waiting for a background task you started with \`run_in_background\`, you will be notified when it completes — do not poll.`,
    parameters: bashSchema,
    outputSchema: bashOutputSchema,
    isReadOnly: false,
    isConcurrencySafe: true,

    validateInput: async (params: BashInput) => {
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

    async execute(toolCallId, params, context) {
      // 一期：run_in_background 返回占位提示
      if (params.run_in_background) {
        return {
          stdout: "Background tasks not yet implemented. Run the command directly without run_in_background.",
          stderr: "",
          exitCode: 1,
          interrupted: false,
          backgroundTaskId: undefined,
          assistantAutoBackgrounded: false,
          dangerouslyDisableSandbox: params.dangerouslyDisableSandbox ?? false,
        };
      }

      return new Promise((resolve, reject) => {
        const child = spawn("bash", ["-c", params.command], { cwd });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        if (params.timeout) {
          timeoutId = setTimeout(() => {
            child.kill("SIGTERM");
          }, params.timeout);
        }

        child.stdout.on("data", (data: Buffer) => stdoutChunks.push(data));
        child.stderr.on("data", (data: Buffer) => stderrChunks.push(data));

        child.on("error", (err) => {
          if (timeoutId) clearTimeout(timeoutId);
          reject(err);
        });

        child.on("close", (code) => {
          if (timeoutId) clearTimeout(timeoutId);
          const interrupted = context.abortSignal.aborted;
          if (interrupted) {
            // 被中断时仍返回输出，标记 interrupted
          }
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          resolve({
            stdout,
            stderr,
            exitCode: code,
            interrupted,
            dangerouslyDisableSandbox: params.dangerouslyDisableSandbox ?? false,
          });
        });
      });
    },

    formatResult(output, _toolCallId) {
      const parts: string[] = [];
      if (output.stdout) parts.push(output.stdout);
      if (output.stderr) parts.push(`stderr:\n${output.stderr}`);
      if (output.interrupted) parts.push("(command was interrupted)");
      if (output.backgroundTaskId) parts.push(`Background task started: ${output.backgroundTaskId}`);
      if (output.assistantAutoBackgrounded) parts.push("Command was auto-backgrounded after timeout.");
      return [{ type: "text", text: parts.join("\n") || "(no output)" }];
    },
  });
}
```

- [ ] **Step 2: 在文件顶部添加 `detectBlockedSleepPattern` 函数**

在 `createBashTool` 函数之前插入：

```typescript
/** 检测被阻止的 sleep 命令模式 */
function detectBlockedSleepPattern(command: string): string | null {
  // 匹配独立的 sleep N（N >= 2）
  const patterns = [
    /^sleep\s+(\d+(?:\.\d+)?)$/,
    /;\s*sleep\s+(\d+(?:\.\d+)?)$/,
    /&&\s*sleep\s+(\d+(?:\.\d+)?)$/,
  ];
  for (const pattern of patterns) {
    const match = command.match(pattern);
    if (match) {
      const seconds = parseFloat(match[1]);
      if (seconds >= 2) {
        return `sleep ${seconds}`;
      }
    }
  }
  return null;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/bash.ts
git commit -m "feat(bash): align name, prompt, validateInput, formatResult with cc"
```

---

### Task 3: 类型检查与测试验证

- [ ] **Step 1: 运行类型检查**

```bash
bun run typecheck
```

Expected: 0 errors

- [ ] **Step 2: 运行测试**

```bash
bun test src/
```

Expected: all pass

- [ ] **Step 3: Commit（如有修复）**

```bash
git add -A
git commit -m "fix(bash): typecheck and test fixes"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ 工具名 `'Bash'` — Task 2 Step 1
- ✅ 参数扩展（timeout 毫秒 + description + run_in_background + dangerouslyDisableSandbox）— Task 1
- ✅ Prompt 完整说明 — Task 2 Step 1
- ✅ validateInput sleep 检测 — Task 2 Step 1 + detectBlockedSleepPattern
- ✅ run_in_background 占位 — Task 2 Step 1 execute 中
- ✅ formatResult 扩展 — Task 2 Step 1

**2. Placeholder scan:** 无 TBD/TODO/"implement later"。

**3. Type一致性：**
- `BashInput` 和 `BashOutput` 类型由 TypeBox schema 推导，与 validateInput 和 execute 签名一致
- `detectBlockedSleepPattern` 返回 `string | null`，与 validateInput 中使用一致
