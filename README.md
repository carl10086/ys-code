# ys-code

AI-powered coding agent CLI. 基于 Bun + TypeScript + Ink 的终端交互式编码助手。

## 功能特性

### Core Agent

- **Agent Session** — 多轮对话会话管理，支持模型选择和思考级别配置
- **Message Streaming** — 流式接收 LLM 响应（thinking + answer delta）
- **Tool Execution** — 工具调用生命周期管理（开始 → 执行 → 结束渲染）
- **Session Persistence** — 会话持久化存储与恢复
- **Context Compaction** — `/compact` 命令压缩会话上下文，防止 token 溢出

### Tools

内置 8 种 agent 工具：

| 工具 | 功能 |
|------|------|
| `Read` | 文件读取（支持多文件、行范围、图片解析） |
| `Write` | 文件写入（带文件锁防并发冲突） |
| `Edit` | 文本替换编辑（diff 格式化展示） |
| `Bash` | 本地 shell 命令执行 |
| `Glob` | 文件 glob 匹配 |
| `Grep` | 文本搜索（支持正则） |
| `WebFetch` | 网页内容获取 |
| `Skill` | 动态调用已加载的 skill |

### Command System

- **Built-in Commands** — `/exit`, `/clear`, `/debug`, `/compact`, `/tools`, `/help`, `/system`, `/skills`
- **Skill Loading** — 三级加载策略（bundled → user settings → project settings）
- **Command Types** — 支持 local、local-jsx、prompt 三种命令类型
- **Dynamic Discovery** — 运行时自动发现和加载用户/项目级自定义命令

### TUI

- **Ink-based UI** — 基于 Ink + React 的终端渲染
- **Message List** — 消息流展示（支持 Markdown、代码块、Diff、表格）
- **Prompt Input** — 命令行输入，支持 slash command 自动补全
- **Status Bar** — 底部状态栏（模型信息、token 消耗、耗时）
- **ANSI Rendering** — ANSI 颜色代码渲染支持

### Web Preview

- **Web Server** — 可选启动本地 Web 服务（`--web` 或 `dev:web`）
- **Session Viewer** — 通过浏览器查看会话历史和消息详情
- **Debug Inspector** — Web 端调试工具，查看 system prompt、工具调用详情

## 技术栈

- **Runtime**: Bun
- **Language**: TypeScript 6.x（严格模式，ES Modules）
- **TUI Framework**: Ink 7.x + React 19.x
- **AI SDK**: @anthropic-ai/sdk, @ai-sdk/anthropic, ai
- **Schema Validation**: Zod, AJV
- **Logging**: pino + pino-pretty
- **Testing**: Bun 内置 test runner + ink-testing-library

## 项目结构

```
src/
  main.ts           # CLI 入口
  cli/              # CLI 参数解析
  commands/         # Slash 命令系统（内置命令 + skill 加载）
  agent/            # Agent 核心（会话、工具、system prompt）
  session/          # 会话持久化、compact 压缩
  tui/              # 终端界面（Ink + React）
  web/              # Web 预览服务（调试、会话查看）
  core/             # AI 模型抽象、类型定义
  skills/           # Skill 加载器
  utils/            # 工具函数
docs/               # 设计文档、规格、计划
examples/           # 使用示例
refer/              # 本地符号链接（外部参考项目）
```

## 开发命令

```bash
# 启动 TUI 交互界面（默认模式）
bun run dev

# 启动 TUI + Web 预览服务
bun run dev:web

# 直接启动 TUI 界面
bun run tui

# 运行测试套件
bun test

# TypeScript 类型检查（不输出文件）
bun run typecheck
```

## 使用指南

### 启动交互

```bash
# 纯 TUI 模式
bun run dev

# TUI + Web 调试模式（Web 服务随机端口）
bun run dev:web
```

### Slash Commands

在 prompt 中输入以下命令：

| 命令 | 说明 |
|------|------|
| `/exit` | 退出程序 |
| `/clear` | 清空当前会话消息 |
| `/compact` | 压缩会话上下文，减少 token 占用 |
| `/debug` | 打开 Debug Inspector |
| `/tools` | 查看可用工具列表 |
| `/help` | 显示帮助信息 |
| `/system` | 查看/操作系统级设置 |
| `/skills` | 查看已加载的 skills |

### 自定义 Skills 和 Commands

项目支持三级覆盖加载策略：

1. **Bundled** — 项目内置的 skills（`src/skills/` 或 `src/commands/skills/`）
2. **User Settings** — 用户级配置（`~/.claude/commands/`）
3. **Project Settings** — 项目级配置（`.claude/commands/`）

加载优先级：Project > User > Bundled。

## 测试

```bash
# 运行全部测试
bun test

# 类型检查
bun run typecheck
```

- 单元测试使用 Bun 内置 `bun:test`
- TUI 组件测试使用 `ink-testing-library`
- Web 路由和 Debug Inspector 有端到端测试

## 代码规范

- 源码使用 `.ts` / `.tsx`，import 路径包含 `.js` 扩展名（ESM 兼容）
- 类型优先，核心数据结构使用 Zod 做运行时校验
- 工具函数优先使用标准库，避免不必要的抽象

## 相关文档

设计文档位于 `docs/` 目录：

- `docs/design/` — 功能设计文档
- `docs/plan/` — 开发计划
- `docs/ys-powers/specs/` — 详细规格说明
- `docs/usage/` — 使用文档
