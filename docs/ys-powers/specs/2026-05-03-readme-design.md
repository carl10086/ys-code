# ys-code README.md 设计规格

## 1. Objective

为 `ys-code` 项目生成一份面向**内部团队**的 `README.md`，定位为**开发参考手册**，需满足以下目标：

- **项目定位清晰**：说明 ys-code 是一个 AI-powered coding agent CLI 工具
- **功能全景呈现**：对齐当前已实现的功能列表，作为团队内部的功能对照单
- **开发 onboarding**：新成员可通过 README 快速了解技术栈、目录结构、常用命令
- **使用指南**：覆盖安装、运行、测试、构建等日常开发操作

**非目标**：
- 不面向外部开源用户（无需贡献指南、行为准则等）
- 不替代详细设计文档（README 是入口，细节指向 `docs/` 目录）

---

## 2. Commands

README 中需文档化的项目级命令：

| 命令 | 用途 |
|------|------|
| `bun run dev` | 启动 TUI 交互界面（默认模式） |
| `bun run dev:web` | 启动 TUI + Web 预览服务 |
| `bun run tui` | 直接启动 TUI 界面 |
| `bun test` | 运行测试套件 |
| `bun run typecheck` | TypeScript 类型检查（不输出文件） |

---

## 3. Project Structure

README 中需呈现的高层目录结构：

```
ys-code/
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

---

## 4. Code Style

README 中需提及的代码规范：

- **语言**：TypeScript 6.x，严格模式
- **运行时**：Bun（唯一运行时，不兼容 Node.js）
- **模块**：ES Modules（`"type": "module"`）
- **TUI 框架**：Ink 7.x + React 19.x
- **文件扩展名**：源码使用 `.ts` / `.tsx`，import 路径包含 `.js` 扩展名（ESM 兼容）
- **测试**：Bun 内置 test runner，ink-testing-library 用于 TUI 组件测试

---

## 5. Testing Strategy

README 中需说明的测试相关信息：

- **测试框架**：Bun 内置 `bun:test`
- **运行方式**：`bun test`
- **TUI 测试**：使用 `ink-testing-library` 进行组件级测试
- **E2E 测试**：Web 路由和 Debug Inspector 有端到端测试
- **类型检查**：`bun run typecheck` 使用 `tsc --noEmit`

---

## 6. Boundaries

### Always Do
- 保持 README 与代码现状同步（功能列表需真实反映已实现的代码）
- 使用简洁的技术写作风格，避免营销文案
- 技术术语保留英文（如 Agent、Session、Tool、Skill、Compact 等）

### Ask First About
- 新增功能模块的说明（README 只描述已稳定实现的功能）
- 架构图的添加（如需 Mermaid 图，需确认团队工具链支持）

### Never Do
- 不提及 `claude-code-haha` 或任何外部参考项目的关联
- 不写未实现的功能（roadmap 内容应放在 `docs/plan/`）
- 不写外部用户导向的安装说明（如 npm install -g 等）

---

## 附录：已实现功能列表（Feature Inventory）

作为 README 中 **Features** 章节的内容来源：

### Core Agent
- [x] **Agent Session**：多轮对话会话管理，支持模型选择和思考级别配置
- [x] **Message Streaming**：流式接收 LLM 响应（thinking + answer delta）
- [x] **Tool Execution**：工具调用生命周期管理（开始 → 执行 → 结束渲染）
- [x] **Session Persistence**：会话持久化存储与恢复
- [x] **Context Compaction**：`/compact` 命令压缩会话上下文，防止 token 溢出

### Tools（8 种内置工具）
- [x] `Read`：文件读取（支持多文件、行范围、图片解析）
- [x] `Write`：文件写入（带文件锁防并发冲突）
- [x] `Edit`：文本替换编辑（diff 格式化展示）
- [x] `Bash`：本地 shell 命令执行
- [x] `Glob`：文件 glob 匹配
- [x] `Grep`：文本搜索（支持正则）
- [x] `WebFetch`：网页内容获取
- [x] `Skill`：动态调用已加载的 skill

### Command System
- [x] **Built-in Commands**：`/exit`, `/clear`, `/debug`, `/compact`, `/tools`, `/help`, `/system`, `/skills`
- [x] **Skill Loading**：三级加载策略（bundled → user settings → project settings）
- [x] **Command Types**：支持 local、local-jsx、prompt 三种命令类型
- [x] **Dynamic Discovery**：运行时自动发现和加载用户/项目级自定义命令

### TUI（Terminal UI）
- [x] **Ink-based UI**：基于 Ink + React 的终端渲染
- [x] **Message List**：消息流展示（支持 Markdown、代码块、Diff、表格）
- [x] **Prompt Input**：命令行输入，支持 slash command 自动补全
- [x] **Status Bar**：底部状态栏（模型信息、token 消耗、耗时）
- [x] **ANSI Rendering**：ANSI 颜色代码渲染支持

### Web Preview
- [x] **Web Server**：可选启动本地 Web 服务（`--web` 或 `dev:web`）
- [x] **Session Viewer**：通过浏览器查看会话历史和消息详情
- [x] **Debug Inspector**：Web 端调试工具，查看 system prompt、工具调用详情

### System & Infra
- [x] **Model Abstraction**：统一模型接口，支持模型切换
- [x] **System Prompt**：可定制的 system prompt，内置 coding-agent prompt
- [x] **File State Tracking**：文件操作状态追踪（防止重复读取）
- [x] **Logging**：结构化日志（pino + pino-pretty）
- [x] **Type Safety**：全项目 TypeScript，Zod 运行时校验
