# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

`ys-code` 是一个分阶段逼近 Claude Code 的可控实现项目：
- 使用与 `claude-code-haha` 完全一致的内核技术栈（Bun、TypeScript）
- 界面层使用 Ink（`ink` + `react`），与 `claude-code-haha` 保持一致，以便快速复用其 TUI 组件和渲染经验

## 目录结构

```
ys-code/
  refer/
    claude-code-haha/    # claude-code 源码, 来源，核心参考项目
  src/                   # 当前项目源码目录
  docs/                  # 设计文档
  debug/                 # 调试相关
```


## Git 工作流

**禁止在 main 分支上直接 commit 和提交。所有变更必须通过 PR 合并。**

- 始终在功能分支上工作，完成后创建 PR
- 禁止 `git commit` 到 main 或 `git push` 到 main
- PR 必须经过 review后才能合并

## 核心依赖说明

当前项目已经预留并锁定了一组核心依赖，作用如下：

- `@commander-js/extra-typings`：后续用于实现类型更完整的 CLI 参数解析。
- `@modelcontextprotocol/sdk`：后续用于接入 MCP 工具协议。
- `chalk`：用于命令行彩色输出。
- `diff`：用于文本 diff 和后续文件变更展示。
- `env-paths`：用于统一管理配置、缓存、数据目录路径。
- `execa`：用于稳定执行本地命令和子进程。
- `ignore`：用于解析 `.gitignore` 风格规则，后续做文件过滤。
- `jsonc-parser`：用于读取带注释的 JSON 配置。
- `picomatch`：用于 glob 匹配和路径筛选。
- `proper-lockfile`：用于处理本地文件锁，避免并发写入冲突。
- `strip-ansi`：用于去除终端 ANSI 控制字符。
- `vscode-jsonrpc`：用于后续 JSON-RPC 通信能力。
- `vscode-languageserver-types`：用于复用 LSP/IDE 相关类型定义。
- `wrap-ansi`：用于终端文本换行显示。
- `yaml`：用于 YAML 配置读写。
- `zod`：用于运行时校验和内部数据结构定义。
- `typescript`：当前项目的 TypeScript 编译与类型检查基础依赖。


## Refer 目录说明

`refer/` 目录用于存放指向外部项目的符号链接，供本地开发时快速引用关联代码库。该目录下的所有条目均为**符号链接（symlink）**，不纳入 Git 版本控制。

### 当前链接目标

| 名称 | 类型 | 本地目标路径 | 用途                         |
|------|------|--------------|----------------------------|
| `claude-code-haha` | 符号链接 | `~/soft/projects/claude-code-haha` | 核心参考源码，内核技术栈对齐来源           |
| `pi-mono` | 符号链接 | `~/soft/projects/pi-mono` | 另一个 agent 项目，架构参考          |
| `cc-query-snapshots` | 符号链接 | `/tmp/cc-query-snapshots` | 运行时 snapshot 数据，用于直接观察运行状态 |

### 使用约定

- `refer/` 下的符号链接仅在本地开发环境有效，跨机器不需要保持一致。
- 新成员初始化项目时，如需引用，可自行创建同名符号链接指向本地对应目录。
- `cc-query-snapshots` 为临时数据，按需使用，不保证持久化。
