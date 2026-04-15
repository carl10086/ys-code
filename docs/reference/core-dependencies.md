# `claude-code-haha` 核心依赖审计

审计来源：`refer/claude-code-haha/package.json`

## 当前建议直接采用

这些依赖建议直接进入当前项目初始化版本，下面给出中文用途说明：

- `@commander-js/extra-typings`：用于后续 CLI 参数解析，提供更好的 TypeScript 类型支持。
- `zod`：用于运行时数据校验和内部 schema 定义，后续做配置、消息结构、工具参数时会用到。
- `jsonc-parser`：用于解析带注释的 JSONC 配置文件，适合后续本地配置文件读取。
- `yaml`：用于读取和生成 YAML 配置，后续做规则、技能、MCP 相关配置时有用。
- `ignore`：用于处理 `.gitignore` 风格的路径过滤规则，后续做文件扫描时需要。
- `picomatch`：用于 glob 匹配，后续做路径筛选、工具输入过滤时需要。
- `execa`：用于执行本地命令，后续做 shell/tool 能力时更稳定。
- `env-paths`：用于统一管理不同操作系统下的配置目录、缓存目录和数据目录。
- `proper-lockfile`：用于文件锁，后续做会话状态、缓存或本地索引写入时避免并发冲突。
- `@modelcontextprotocol/sdk`：用于接入 MCP 协议，是后续工具系统的重要基础依赖。
- `vscode-jsonrpc`：用于 JSON-RPC 通信，后续如果和编辑器、服务端协议打通会用到。
- `vscode-languageserver-types`：提供语言服务协议相关通用类型，适合后续 IDE/诊断上下文建模。
- `chalk`：用于命令行彩色输出。
- `strip-ansi`：用于去除终端 ANSI 颜色控制字符，适合日志和文本处理。
- `wrap-ansi`：用于终端文本换行，后续做 CLI/TUI 文本展示时有用。
- `diff`：用于文本 diff 展示，后续做文件变更、补丁预览时需要。

## 当前先不安装

- `@anthropic-ai/sdk`：参考项目当前使用的模型 SDK，但你已经决定后续 AI 层单独规划。
- `@anthropic-ai/sandbox-runtime`：和沙箱执行环境相关，初始化阶段还不需要。
- `@aws-sdk/client-bedrock-runtime`：和 Bedrock provider 相关，当前不接入。
- `google-auth-library`：和 Google 认证相关，当前不接入。
- `axios`：通用 HTTP 客户端，当前这轮没有远程服务调用需求。
- `undici`：另一类 HTTP 能力，当前这轮不需要。
- `ws`：WebSocket 通信能力，当前不需要。
- `chokidar`：文件监听能力，初始化阶段暂时不需要。
- OpenTelemetry 相关包：可观察性和 tracing 能力，等后续系统复杂后再补。

说明：AI 这一层后续单独规划，并优先考虑 `vercel/ai`。

## 当前明确排除

- `ink`：参考项目当前 TUI 技术栈，不是 `ys-code` 这一阶段要接入的方案。
- `react`：主要服务于现有 Ink UI，这一轮项目初始化不需要。
- `react-reconciler`：属于 UI 渲染链路，当前不需要。
- `usehooks-ts`：前端/交互层 hook 工具，当前不需要。
- `highlight.js`：代码高亮相关，初始化阶段不需要。
- `qrcode`：二维码展示能力，当前不需要。
- `medium-zoom`：文档/页面交互能力，当前不需要。
- `vitepress`：文档站点工具，不属于当前项目初始化范围。
- `vue`：主要服务于文档/UI 体系，当前不需要。

说明：当前只做项目初始化，不接入 UI 技术栈。
