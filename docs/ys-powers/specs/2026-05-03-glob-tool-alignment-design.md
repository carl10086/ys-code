# Spec: GlobTool 对齐 Claude Code

## Objective

将 `ys-code` 的 `GlobTool` 从当前的最小可用实现升级为更接近 Claude Code 行为契约的文件名搜索工具，让 agent 在查找文件路径时获得稳定、可审查、不会刷屏且安全边界一致的结果。

**背景：**
- 当前 `ys-code` 已有 `GlobTool`，默认注册在 `AgentSession` 工具列表中。
- `src/agent/system-prompt/sections/using-your-tools.ts` 和 `Bash` tool description 已要求文件搜索使用 `Glob` 而不是 `find` 或 `ls`。
- 现有 `GlobTool` 直接调用 `rg --files --glob <pattern> --sort=modified --no-ignore --hidden`，缺少路径 containment、absolute glob 拆分、输出流式上限、超时/取消处理、TUI search result 结构化展示和系统化测试。
- 刚完成的 `GrepTool` 已建立一套较稳的搜索工具边界：相对路径输出、默认安全排除、受控截断、TUI `search_result` 渲染、终端输出消毒。本次 `GlobTool` 应复用这些原则，而不是引入 Claude Code 的完整权限系统。

**目标用户：**
- TUI 用户：希望 agent 快速定位文件，并看到简洁、可展开、不会刷屏的文件列表。
- 后续工具实现者：希望 `Glob` 与 `Grep` 行为一致，减少模型退回 `Bash find/ls` 的情况。

**成功标准：**
- [ ] `Glob` 保持 Claude Code 对齐的输入 schema：`pattern` 必填，`path` 可选。
- [ ] 支持 relative glob 与 absolute glob；absolute glob 会拆分为搜索基目录和相对 pattern。
- [ ] `path` 和 absolute glob 的搜索目录必须限制在当前 `cwd` 内，拒绝逃逸路径和危险路径。
- [ ] 输出路径统一相对 `cwd`，不会泄露临时目录或绝对工作区路径。
- [ ] 默认结果按修改时间排序，输出上限为 100，使用 sentinel 方式判断是否截断。
- [ ] 默认继承 `GrepTool` 的轻量安全排除：VCS 目录、依赖目录、构建产物、常见 secret 文件。
- [ ] 支持 `AbortSignal`、超时和 bounded stdout/stderr，避免大仓库或异常命令污染上下文。
- [ ] `formatResult` 与 Claude Code 文本结果兼容：无结果为 `No files found`，截断时追加提示。
- [ ] `renderResult` 返回 `search_result`，TUI 复用 Grep 搜索结果展示能力。
- [ ] 不引入 Claude Code 完整权限系统、不新增依赖、不改动 `GrepTool` 已 ship 的核心行为。

## Tech Stack

- **Runtime:** Bun + TypeScript
- **Schema:** `@sinclair/typebox`
- **TUI Framework:** Ink + React
- **Search Backend:** 系统 `rg` 命令
- **Test Framework:** `bun:test`
- **无需新增依赖**

## Commands

```bash
# GlobTool 单元测试
bun test ./src/agent/tools/glob.test.ts

# 搜索结果 TUI 展示回归
bun test ./src/tui/components/MessageItem.integration.test.tsx

# 工具执行链路回归
bun test ./src/agent/tool-execution.test.ts

# 全量测试
bun test

# 类型检查
bun run typecheck

# 手动 TUI 验证
bun run tui
```

## Project Structure

```text
src/
  agent/
    tools/
      glob.ts
        -> 修改：补齐 Claude Code 对齐行为、安全边界、renderResult
      glob.test.ts
        -> 新增/扩展：覆盖 schema、路径、安全、截断、排序、absolute glob、取消和错误
      grep.ts
        -> 参考：复用设计原则，不在本轮重构
    types.ts
      -> 已有：ToolRenderResult 支持 search_result；如当前类型不足，仅做加法补齐
    tool-execution.test.ts
      -> 可选扩展：确保真实 Glob renderData 能穿透 tool_execution_end
  tui/
    components/
      MessageItem.tsx
        -> 复用已有 search_result 渲染；仅在 Glob 需要展示差异时做最小修改
      MessageItem.integration.test.tsx
        -> 扩展：覆盖 Glob search_result 简洁展示和终端消毒
docs/
  ys-powers/
    specs/
      2026-05-03-glob-tool-alignment-design.md
        -> 本 spec
```

## Code Style

遵循当前 `ys-code` 的 tool 工厂模式：使用 `defineAgentTool` 包装工具定义，输入输出用 TypeBox schema，执行返回结构化 output，`formatResult` 面向 LLM，`renderResult` 面向 TUI。

**输入参数契约保持小而稳定：**

```ts
const globSchema = Type.Object({
  pattern: Type.String({
    description: "The glob pattern to match files against",
    maxLength: 1000,
  }),
  path: Type.Optional(Type.String({
    description:
      'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
    maxLength: 1000,
  })),
});
```

**输出结构保持 Claude Code 兼容：**

```ts
type GlobOutput = {
  durationMs: number;
  numFiles: number;
  filenames: string[];
  truncated: boolean;
  appliedLimit: number;
};
```

**TUI renderData 复用搜索结果类型：**

```ts
renderResult(output) {
  return {
    type: "search_result",
    mode: "files_with_matches",
    numFiles: output.numFiles,
    filenames: output.filenames,
    truncated: output.truncated,
  };
}
```

命名和组织约定：
- 辅助函数放在 `glob.ts` 内部，除非 Grep/Glob 确认需要共享后再抽出公共模块。
- 优先复用 `grep.ts` 中已经验证过的思路，但本轮不做大规模共享重构。
- 错误消息应稳定、具体、面向恢复路径，例如提示目录不存在、路径越界、`rg` 不可用或搜索超时。
- 所有暴露给 LLM/TUI 的路径必须是相对 `cwd` 的路径；越界路径不应该进入结果。

## Glob 行为要求

### 输入语义

- `pattern: string`：必填，使用 ripgrep glob 语法，如 `**/*.ts`、`src/**/*.tsx`、`*.{js,ts}`。
- `path?: string`：可选搜索目录，默认当前 `cwd`。
- 不新增 `head_limit`、`offset` 等模型可见参数。Claude Code 的 `GlobTool` 对模型只暴露 `pattern/path`，内部固定 `limit=100, offset=0`。
- 明确拒绝字符串 `"undefined"` 和 `"null"` 作为 `path`，错误提示应建议省略字段。

### absolute glob 处理

Claude Code 的 `utils/glob.ts` 会对 absolute glob 做 base directory 拆分，因为 `rg --glob` 只可靠处理相对 pattern。本轮实现同等能力：

```text
/repo/src/**/*.ts
  -> searchDir: /repo/src
  -> searchPattern: **/*.ts

/repo/package.json
  -> searchDir: /repo
  -> searchPattern: package.json
```

实现要求：
- 以第一个 glob 特殊字符 `* ? [ {` 为界提取 static prefix。
- 对没有 glob 字符的 literal path，使用 dirname 作为搜索目录，basename 作为 pattern。
- `path` 与 absolute `pattern` 不同时指定为不同根时，优先保持简单：`path` 决定搜索根，absolute `pattern` 必须位于该根下，否则返回输入错误。
- 搜索目录必须经过 `resolve` + `realpath`，并确保在 `realpath(cwd)` 内。

### rg 参数构造

默认参数：

```text
rg --files --glob <searchPattern> --sort=modified --hidden
```

边界参数：
- 默认加入 `--hidden`，与 Claude Code 一致，保证隐藏配置文件可被定位。
- 不使用无约束的 `--no-ignore` 作为唯一安全策略。为匹配 Claude Code 行为，可保持 `--no-ignore`，但必须同时注入 deny glob 排除敏感和大目录；如果实现时发现 secret 风险更高，可选择尊重 `.gitignore`，但需在 spec 更新中说明。
- 注入排除规则：
  - VCS: `.git/**`, `.svn/**`, `.hg/**`, `.bzr/**`, `.jj/**`, `.sl/**`
  - 大目录: `node_modules/**`, `dist/**`, `build/**`
  - 常见 secret: `.env`, `.env.*`, `.npmrc`, `.pypirc`, `.netrc`, `.yarnrc`, `.aws/**`, `.ssh/**`, `id_rsa`, `id_dsa`, `id_ecdsa`, `id_ed25519`, `*.pem`, `*.key`, `*.p12`, `*.pfx`
- 排除规则应同时覆盖根目录和嵌套目录，例如 `node_modules/**` 与 `**/node_modules/**`。

### 输出和截断

- 内部读取最多 `MAX_RESULTS + 1` 行，默认 `MAX_RESULTS = 100`。
- 只有读到第 101 条时才标记 `truncated: true`，刚好 100 条不应标记截断。
- `filenames` 只返回前 100 条。
- `numFiles` 表示返回给模型的文件数，而不是仓库中真实总数。此点与 Claude Code 当前输出 schema 的可观察行为一致。
- 输出路径按 `cwd` relativize；如果路径不在 `cwd` 内，视为安全错误或过滤，不直接返回绝对路径。
- `formatResult`：
  - 无结果：`No files found`
  - 有结果：逐行输出相对路径
  - 截断：追加 `(Results are truncated. Consider using a more specific path or pattern.)`

### 超时、取消和错误

- 使用 `context.abortSignal` 取消搜索。
- 默认 timeout 参考 GrepTool，建议 `20_000ms`；WSL 特化不是本轮必需。
- stdout/stderr 都必须有 byte limit，避免 `rg` 异常或大仓库输出造成内存压力。
- `rg` exit code `0` 和 `1` 视为成功，`1` 代表无结果。
- 对 `ENOENT`、`EACCES`、`EPERM`、usage error、timeout 给出清晰错误。
- 可选实现 EAGAIN 单线程重试：第一次 `rg` 因 `Resource temporarily unavailable` 失败时，用 `-j 1` 重试一次；如果范围超出，至少在测试中覆盖错误不会被误报成无结果。

## TUI 展示

`GlobTool` 的用户可见名称与 Claude Code 保持一致，建议仍显示为 `Search` 或沿用现有工具名 `Glob`。考虑 `ys-code` 当前 TUI 已显示 tool name，本轮不强制改名，只要求结果展示稳定。

展示要求：
- tool use 摘要显示 `pattern: "<pattern>"`，有 `path` 时显示 `pattern: "<pattern>", path: "<path>"`。
- tool result 使用 `search_result`：
  - summary 显示找到的文件数和耗时。
  - detail 显示相对路径列表。
  - 截断时显示 render limit 提示。
- 所有展示文本经过现有 terminal sanitization，避免 pattern/path 中的控制序列污染终端。

## Testing Strategy

### GlobTool 单元测试

新增或扩展 `src/agent/tools/glob.test.ts`，覆盖：
- 默认搜索返回相对路径，按修改时间排序。
- 无结果返回 `No files found`。
- `path` 限定搜索目录。
- `path` 不存在返回 errorCode `1`。
- `path` 是文件返回 errorCode `2`。
- `path` 为 `"undefined"` 或 `"null"` 时返回输入错误。
- relative glob 支持 `**/*.ts`、`src/**/*.ts`、`*.{js,ts}`。
- absolute glob 会拆分搜索根，并仍输出相对 `cwd` 路径。
- absolute glob 或 `path` 逃逸 `cwd` 时被拒绝。
- symlink 指向 `cwd` 外部时被 `realpath` containment 拒绝。
- 默认排除 `.git`、`node_modules`、`dist`、`build`、secret 文件。
- 结果刚好等于 100 条时不标记截断；超过 100 条时标记截断。
- `AbortSignal` 取消或 timeout 不会挂起测试。
- `rg` 不存在或失败时错误清晰。

### TUI / tool execution 集成测试

- `MessageItem.integration.test.tsx` 覆盖 `Glob` 的 `search_result` 展示，确保摘要简洁、详情可读、控制序列被消毒。
- `tool-execution.test.ts` 可增加真实 `GlobTool` 的 `renderData` 穿透测试，和 GrepTool 的回归保持一致。

### 回归验证

每轮实现后运行：

```bash
bun test ./src/agent/tools/glob.test.ts
bun test ./src/tui/components/MessageItem.integration.test.tsx
bun test ./src/agent/tool-execution.test.ts
bun test
bun run typecheck
```

如果修改了依赖或 lockfile，额外运行：

```bash
npm audit --registry=https://registry.npmjs.org
```

## Boundaries

### Always

- 保持 `Glob` 的模型可见输入 schema 简洁：只暴露 `pattern/path`。
- 所有结果路径使用相对 `cwd` 路径。
- 对用户输入路径做 `resolve`、`realpath` 和 containment 校验。
- 默认排除 VCS、大目录和常见 secret 文件。
- 对 stdout/stderr、结果数量和执行时间加上边界。
- 用测试覆盖每个安全和输出语义变更。
- 遵循当前 `defineAgentTool`、TypeBox、`formatResult`、`renderResult` 模式。

### Ask First

- 引入新的 glob/ripgrep 依赖或 vendored binary。
- 抽出 Grep/Glob 共享 search runner，导致大范围修改已 ship 的 `GrepTool`。
- 改动 `AgentLoop`、权限系统或系统提示主结构。
- 改变 `.gitignore` 尊重策略与 Claude Code 默认差异较大的行为。
- 将 `GlobTool` 扩展为内容搜索或多模式搜索。

### Never

- 不直接读取或返回 secret 文件内容；`Glob` 只返回路径，且默认排除常见 secret 路径。
- 不允许 `path` 或 absolute glob 逃逸当前工作区。
- 不让 TUI 展示无限文件列表。
- 不为了对齐 Claude Code 而引入完整权限系统。
- 不在 `main` 分支直接 commit 或 push。
- 不修改 `refer/` 下的参考项目。

## Success Criteria

1. `GlobTool` 的输入/输出 schema 与 Claude Code 的可见契约保持兼容。
2. relative 和 absolute glob 都能工作，并始终输出相对路径。
3. 搜索边界与 `GrepTool` 一致：工作区 containment、默认排除、输出有界、错误清晰。
4. 大结果集不会刷屏，截断语义准确。
5. TUI 中 `Glob` 结果以 `search_result` 简洁展示。
6. 新增/更新测试覆盖主要行为、错误和安全边界。
7. `bun test` 和 `bun run typecheck` 通过。

## Open Questions

- 是否必须完全保留 Claude Code 的 `--no-ignore` 默认？本 spec 推荐“保留 hidden 能力，同时用安全排除兜底”；实现时如果选择尊重 `.gitignore`，需要先更新本 spec 并说明原因。
- 是否要在本轮实现 EAGAIN 单线程重试？推荐作为 P1，可先保证错误清晰且不会误判为无结果。
- TUI 用户可见名称是否改为 Claude Code 的 `Search`？推荐先沿用当前工具名展示，避免扩大 UI 语义变化。

## Implementation Plan

### Task 1: 补齐 GlobTool 输入校验和路径解析

- 修改 `src/agent/tools/glob.ts`。
- 新增 `extractGlobBaseDirectory`、`validateGlobInput`、`isInsideDirectory` 等局部 helper。
- 覆盖 `path`、absolute glob、symlink、逃逸路径和 `"undefined"`/`"null"`。
- 验证：`bun test ./src/agent/tools/glob.test.ts`。

### Task 2: 重写 rg 执行与输出截断

- 改造 `runRipgrep` 为 bounded streaming/sentinel 读取。
- 注入默认排除规则、timeout、abort、stderr limit。
- 保持 `formatResult` 与 Claude Code 文本格式兼容。
- 验证：GlobTool 单元测试覆盖排序、截断、错误和排除。

### Task 3: 接入 TUI search_result

- 为 `GlobTool` 增加 `renderResult`。
- 复用或最小扩展 `MessageItem` 的 `search_result` 展示。
- 验证：`bun test ./src/tui/components/MessageItem.integration.test.tsx`。

### Task 4: 集成回归和最终验证

- 增加真实 `GlobTool` 的 `tool_execution_end` renderData 穿透测试（如必要）。
- 运行定向测试、全量测试和类型检查。
- 手动 TUI 验证：让 agent 使用 `Glob` 查找 `src/**/*.ts`，确认输出简洁且路径相对。
