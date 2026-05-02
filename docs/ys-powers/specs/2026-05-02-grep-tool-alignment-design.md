# Spec: GrepTool 对齐 Claude Code

## Objective

实现并集成对齐 Claude Code 行为的 `GrepTool`，让 agent 在代码内容搜索时使用专用只读工具，而不是通过 `Bash` 调用 `grep` 或 `rg`。

**背景：**
- 当前 `ys-code` 已实现 `Read`、`Write`、`Edit`、`Bash`、`Glob`、`WebFetch`、`Skill`
- `src/agent/system-prompt/sections/using-your-tools.ts` 和 `Bash` tool description 已要求内容搜索使用 `Grep`
- 但当前项目还没有真正实现并注册 `GrepTool`，模型只能退回 `Bash rg`
- Claude Code 的 `GrepTool` 基于 `ripgrep`，支持文件列表、匹配内容、计数、上下文行、分页和 multiline 搜索

**用户故事：**
- 作为 TUI 用户，我可以让 agent 快速搜索代码内容，并获得稳定、可审查、不会刷屏的搜索结果
- 作为后续实现者，我可以基于 `GrepTool` 让模型遵守“专用工具优先”的系统提示

**成功标准：**
- [ ] `AgentSession` 默认工具列表包含 `Grep`
- [ ] LLM payload 中包含 `Grep` tool schema，模型能主动调用它
- [ ] `Grep` 支持 CC 对齐的核心参数与三种输出模式
- [ ] `Grep` 的 LLM tool result 格式清晰、可分页、使用相对路径
- [ ] TUI 能显示搜索摘要，并支持查看详细搜索结果
- [ ] 不引入 Claude Code 完整权限系统，不扩大本次范围

## Tech Stack

- **Runtime:** Bun + TypeScript
- **Schema:** `@sinclair/typebox`
- **TUI Framework:** Ink + React
- **Search Backend:** 系统 `rg` 命令
- **Test Framework:** `bun:test`
- **无需新增依赖**

## Commands

```bash
# GrepTool 单元测试
bun test ./src/agent/tools/grep.test.ts

# TUI renderData / MessageItem 相关测试
bun test ./src/tui/components/MessageItem.integration.test.tsx

# 全量测试
bun test

# 类型检查
bun run typecheck

# 手动 TUI 验证
bun run tui
```

## Project Structure

```
src/
  agent/
    session.ts
      → 修改：默认工具列表加入 createGrepTool(options.cwd)
    types.ts
      → 修改：ToolRenderResult 新增 search_result 类型
    tools/
      grep.ts
        → 新增：GrepTool 实现
      grep.test.ts
        → 新增：GrepTool 行为测试
      index.ts
        → 修改：导出 createGrepTool
    system-prompt/
      sections/
        using-your-tools.ts
          → 已有：内容搜索使用 Grep 的提示，必要时微调
  tui/
    hooks/
      useAgent.ts
        → 修改：tool_end 保留 event.renderData
    components/
      MessageItem.tsx
        → 修改：渲染 search_result 摘要和详细内容
      MessageItem.integration.test.tsx
        → 修改/新增：覆盖 search_result 展示
docs/
  ys-powers/
    specs/
      2026-05-02-grep-tool-alignment-design.md
        → 本 spec
```

## Code Style

遵循当前 `ys-code` 的 tool 工厂模式：使用 `defineAgentTool` 包装，输入输出用 TypeBox schema，执行结果通过 `formatResult` 提供给 LLM，通过 `renderResult` 提供给 TUI。

**工具注册示例：**

```ts
const tools = options.tools ?? [
  createReadTool(options.cwd),
  createWriteTool(options.cwd),
  createEditTool(options.cwd),
  createBashTool(options.cwd),
  createGlobTool(options.cwd),
  createGrepTool(options.cwd),
  createWebFetchTool(),
];
```

**输入参数契约：**

```ts
const grepSchema = Type.Object({
  pattern: Type.String({ description: "The regular expression pattern to search for in file contents" }),
  path: Type.Optional(Type.String({ description: "File or directory to search in. Defaults to cwd." })),
  glob: Type.Optional(Type.String({ description: 'Glob pattern to filter files, e.g. "*.ts" or "*.{ts,tsx}"' })),
  output_mode: Type.Optional(Type.Union([
    Type.Literal("content"),
    Type.Literal("files_with_matches"),
    Type.Literal("count"),
  ])),
  "-B": Type.Optional(Type.Number()),
  "-A": Type.Optional(Type.Number()),
  "-C": Type.Optional(Type.Number()),
  context: Type.Optional(Type.Number()),
  "-n": Type.Optional(Type.Boolean()),
  "-i": Type.Optional(Type.Boolean()),
  type: Type.Optional(Type.String()),
  head_limit: Type.Optional(Type.Number()),
  offset: Type.Optional(Type.Number()),
  multiline: Type.Optional(Type.Boolean()),
});
```

**输出结构：**

```ts
type GrepOutput = {
  mode: "content" | "files_with_matches" | "count";
  numFiles: number;
  filenames: string[];
  content?: string;
  numLines?: number;
  numMatches?: number;
  appliedLimit?: number;
  appliedOffset?: number;
};
```

**TUI renderData 示例：**

```ts
return {
  type: "search_result",
  mode: output.mode,
  numFiles: output.numFiles,
  filenames: output.filenames,
  content: output.content,
  numLines: output.numLines,
  numMatches: output.numMatches,
};
```

## Grep 行为要求

### 输入参数

- `pattern: string`：必填，使用 ripgrep regex 语法
- `path?: string`：搜索文件或目录，默认 `cwd`
- `glob?: string`：文件过滤，如 `*.ts`、`**/*.tsx`、`*.{js,ts}`
- `output_mode?: "content" | "files_with_matches" | "count"`：默认 `files_with_matches`
- `-B?: number`：content 模式下显示前置上下文行
- `-A?: number`：content 模式下显示后置上下文行
- `-C?: number` / `context?: number`：content 模式下显示前后上下文，`context` 优先于 `-C`，两者优先于 `-A/-B`
- `-n?: boolean`：content 模式下是否显示行号，默认 `true`
- `-i?: boolean`：大小写不敏感搜索
- `type?: string`：ripgrep `--type`，如 `ts`、`js`、`rust`
- `head_limit?: number`：默认 `250`，`0` 表示不限制
- `offset?: number`：分页跳过前 N 条，默认 `0`
- `multiline?: boolean`：启用 `-U --multiline-dotall`

### rg 参数构造

- 默认加入 `--hidden`
- 默认加入 `--max-columns 500`
- 默认排除 VCS 目录：`.git`、`.svn`、`.hg`、`.bzr`、`.jj`、`.sl`
- 按 `ys-code` 当前安全边界额外排除：`node_modules`、`dist`、`build`
- `output_mode === "files_with_matches"` 时加入 `-l`
- `output_mode === "count"` 时加入 `-c`
- `output_mode === "content"` 且 `-n !== false` 时加入 `-n`
- `multiline === true` 时加入 `-U --multiline-dotall`
- `pattern` 以 `-` 开头时使用 `-e pattern`，避免被 `rg` 当作 flag
- `glob` 支持空格拆分和逗号拆分，但包含 brace pattern 的片段不再按逗号拆

### 输出格式

- `files_with_matches`
  - 返回按修改时间倒序排序的相对路径
  - LLM 文本格式：`Found N files\n<relative paths>`
  - 无结果：`No files found`

- `content`
  - 返回匹配行内容
  - 默认包含行号
  - 匹配行中的绝对路径转换为相对路径
  - 分页时追加：`[Showing results with pagination = limit: X, offset: Y]`
  - 无结果：`No matches found`

- `count`
  - 返回 `file:count` 行
  - 统计 `numMatches` 和 `numFiles`
  - 追加 summary：`Found X total occurrences across Y files.`
  - 无结果：`No matches found`

## TUI 展示

当前 `AgentSession` 已经在 `tool_end` event 中带出 `renderData`，但 `src/tui/hooks/useAgent.ts` 没有传递给 UI message。本次需要修复该链路。

`ToolRenderResult` 新增：

```ts
type SearchResultRenderData = {
  type: "search_result";
  mode: "content" | "files_with_matches" | "count";
  numFiles: number;
  filenames: string[];
  content?: string;
  numLines?: number;
  numMatches?: number;
};
```

展示策略：
- 折叠摘要：
  - `files_with_matches`：`Found N files`
  - `content`：`Found N lines`
  - `count`：`Found X matches across Y files`
- 展开内容：
  - `files_with_matches`：显示文件列表
  - `content`：显示匹配行
  - `count`：显示 `file:count` 内容
- 快捷键和 focus 机制按当前 TUI 能力落地；第一版必须支持摘要和详细内容展示，不要求完整复刻 CC 的 `Ctrl+O` 精确交互

## Testing Strategy

### GrepTool 单元测试

覆盖：
- 默认 `files_with_matches` 返回匹配文件，路径为相对路径
- `content` 模式返回匹配行，默认带行号
- `count` 模式返回每文件匹配数和总数
- `glob` 过滤生效，支持逗号/空格拆分和 brace pattern
- `type` 过滤生效
- `-i` 大小写不敏感
- `-A/-B/-C/context` 只在 content 模式生效，且 `context` 优先
- `head_limit`、`offset` 分页生效，`head_limit: 0` 不限制
- `pattern` 以 `-` 开头时不会被 `rg` 当成 flag
- `multiline` 可跨行匹配
- 不存在的 `path` 返回 validation error
- 自动排除 `.git`、`node_modules`、`dist`、`build`
- `files_with_matches` 在测试环境排序稳定

### TUI / 集成测试

覆盖：
- `tool_end` 会把 `renderData` 从 session 传到 UI
- `search_result` 三种 mode 都能渲染摘要
- 详细内容能够展示文件列表、匹配行或 count 内容

### 回归测试

- `bun test`
- `bun run typecheck`

## Boundaries

- **Always:**
  - 使用 `Grep` 作为内容搜索专用工具，保持 `Bash` description 中的 dedicated tool 优先原则
  - 返回给 LLM 的 tool result 必须足够完整，不能只返回 TUI 摘要
  - 搜索结果路径统一尽量使用相对路径，减少 token 消耗
  - 默认限制结果规模，避免搜索结果污染上下文
  - 测试覆盖三种 `output_mode`

- **Ask first:**
  - 引入新的依赖或 vendored binary
  - 设计完整 Claude Code 权限系统
  - 改动 `AgentLoop` 主流程
  - 改动 `Read`、`Glob`、`Bash` 的核心行为
  - 设计跨 tool 的统一搜索结果 UI 框架

- **Never:**
  - 在本次实现中直接修改 `refer/claude-code-haha`
  - 读取或搜索 `node_modules/`、`dist/`、`build/`、`.git/` 等大目录作为默认行为
  - 依赖 `Bash` 调 `rg` 作为最终实现
  - 让 TUI 默认刷出大量搜索详情导致终端不可读
  - 在 `main` 分支直接 commit

## Success Criteria

1. `src/agent/tools/grep.ts` 实现 `createGrepTool(cwd)`
2. `src/agent/tools/index.ts` 导出 `createGrepTool`
3. `src/agent/session.ts` 默认注册 `Grep`
4. LLM payload 中出现 `Grep` tool schema
5. `Grep` 支持完整输入参数集合和三种输出模式
6. 搜索结果默认排除 VCS 目录和 `node_modules/dist/build`
7. `files_with_matches` 结果按修改时间倒序排序，测试环境稳定排序
8. `formatResult` 对三种 mode 输出符合本 spec
9. `renderResult` 返回 `search_result`
10. TUI 能展示 `search_result` 摘要和详细内容
11. `bun test ./src/agent/tools/grep.test.ts` 通过
12. `bun test` 和 `bun run typecheck` 通过

## Plan

### 任务分解

1. **实现 GrepTool schema 与执行逻辑**
   - 文件：`src/agent/tools/grep.ts`
   - 验收：支持参数构造、三种 output mode、分页、排除目录、相对路径输出
   - 验证：`bun test ./src/agent/tools/grep.test.ts`

2. **补齐 GrepTool 单元测试**
   - 文件：`src/agent/tools/grep.test.ts`
   - 验收：覆盖本 spec 的 GrepTool 单测范围
   - 验证：`bun test ./src/agent/tools/grep.test.ts`

3. **注册 GrepTool**
   - 文件：`src/agent/tools/index.ts`、`src/agent/session.ts`
   - 验收：默认 `AgentSession` tools 包含 `Grep`
   - 验证：新增或更新 session/tool registry 相关测试

4. **扩展 ToolRenderResult 与 TUI 透传**
   - 文件：`src/agent/types.ts`、`src/tui/hooks/useAgent.ts`
   - 验收：`tool_end` UI message 保留 `renderData`
   - 验证：相关 hook 或集成测试通过

5. **实现 search_result TUI 展示**
   - 文件：`src/tui/components/MessageItem.tsx`
   - 验收：三种 mode 都能显示摘要和详细内容
   - 验证：`bun test ./src/tui/components/MessageItem.integration.test.tsx`

6. **回归验证**
   - 验收：现有功能不回退
   - 验证：`bun test`、`bun run typecheck`

### 依赖顺序

任务 1 和任务 2 先完成；任务 3 依赖任务 1；任务 4 和任务 5 依赖任务 1 的 `search_result` 输出结构；任务 6 最后执行。

## Open Questions

- `search_result` 的展开交互是否后续需要精确对齐 Claude Code 的 `Ctrl+O` 行为？
- 是否需要在后续独立 spec 中实现 ripgrep resolver，支持 system/vendor/embedded 三层选择？
