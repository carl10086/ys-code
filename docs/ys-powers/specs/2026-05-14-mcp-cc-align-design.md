# ys-code MCP 与 claude-code 对齐 — Spec

| 字段     | 值                                                                |
|--------|------------------------------------------------------------------|
| 创建日期   | 2026-05-14                                                       |
| 类型     | 渐进式对齐 Spec                                                       |
| 分支     | `feat/mcp-cc-align`                                              |
| 上游参考   | `refer/claude-code-haha/src/services/mcp/`、`commands/mcp/`        |
| 历史依据   | `sop/sop-20260513-001-mcp-tui-integration.md`                    |
| 目标     | 把 ys-code MCP 模块的安全性、诊断、恢复、可用性逐步对齐到 cc 同款水平，分三阶段交付（P0 → P1 → P1） |

---

## 1. Objective（目标）

### 1.1 总体目标

`ys-code` 的 MCP 模块当前规模约 600 行，相对 cc 的 ~12880 行只能算 MVP。本 spec 不追求功能全对齐，而是聚焦四类高 ROI 项：

1. **诊断可观察性**（P0）— 让 stdio server 启动失败有 root cause 可查
2. **资源回收**（P0）— 杜绝连接超时后的子进程 / socket 泄露
3. **配置健壮性**（P0）— `${VAR}` 缺失不再静默生成空串
4. **运行时稳定性**（P1）— 状态机 + 指数退避，HTTP server 抖动可自恢复
5. **schema 兼容**（P1）— 真实生态（filesystem、postgres 等）大量 `oneOf`，当前会丢字段
6. **用户体验**（P1）— CLI 子命令替代手写 JSON

### 1.2 三阶段拆分

| 阶段       | PR 目标         | 内容                                                         | 优先级 |
|----------|---------------|------------------------------------------------------------|-----|
| Phase 1  | P0 一阶段合入      | stderr pipe→logger / connect timeout disconnect / env warn | P0  |
| Phase 2  | 状态机 + 重连      | discriminated union 状态机 + HTTP 指数退避重连                      | P1  |
| Phase 3  | schema + CLI  | jsonSchemaToTypeBox 扩展 + `ys mcp add/remove/list`          | P1  |

三阶段**互不阻塞**，可以独立合入 / 回滚。Phase 1 是其他两期的稳定性基础。

### 1.3 边界条件

- **一期 P0（本 spec 核心）**：仅修复 stderr / timeout / env，不引入新依赖、不改 public API、不影响现有调用方
- **二期 P1 状态机**：不实现 OAuth；`needs-auth` 仅作为占位状态（识别 401 → 不重连），不弹 UI
- **三期 P1 schema + CLI**：CLI 只覆盖 `project` scope（`.mcp.json`）；user/local scope 留 P2；不实现 `ys mcp reconnect`
- **不做**：reconnect 命令、user/local scope、OAuth、SSE/WS transport、动态热重载、TUI 连接状态展示

### 1.4 成功标准

每个阶段独立验证：

**Phase 1（P0）成功标准**

- [ ] 用 `command: "false"` 或不存在的命令配置 server，能在 logger 中看到 stderr 内容（不是只一行 timeout）
- [ ] 连接超时后用 `lsof` 检查无残留子进程，单测验证 `disconnect()` 被调用 1 次
- [ ] `.mcp.json` 引用未定义的 `${MISSING_KEY}` 时，logger 输出 warn 包含变量名
- [ ] `${VAR:-default}` 在 VAR 未设时取 default
- [ ] 现有 `loadMcpServers()` API 签名不变

**Phase 2（状态机）成功标准**

- [ ] 4 状态机（pending / connected / failed / needs-auth）的转换路径单测全覆盖
- [ ] HTTP server 被 kill 后，能在 1+2+4+8+16 秒退避序列内重连成功
- [ ] 5 次重试失败后状态变 failed 且不再重连
- [ ] stdio crash 后状态直接进 failed（不重连，与 cc 一致）

**Phase 3（schema + CLI）成功标准**

- [ ] `jsonSchemaToTypeBox` 支持 oneOf / anyOf / allOf / const / nullable / format / pattern
- [ ] 用真实 `@modelcontextprotocol/server-filesystem` 的 inputSchema 转换不丢字段
- [ ] `ys mcp add demo -- echo hello` 成功写入 `.mcp.json`，文件原子写
- [ ] `ys mcp remove demo` / `ys mcp list` 正常工作
- [ ] CLI 拒绝非法 server 名称

---

## 2. Commands（命令与入口）

### 2.1 Phase 1 / Phase 2

**无新增 CLI 命令**。所有改动都在内部模块，外部 API 兼容。

### 2.2 Phase 3 新增 CLI

```
ys mcp add <name> <commandOrUrl> [args...]
  -t, --transport <type>      stdio | http（默认 stdio）
  -e, --env <KEY=VALUE>       注入环境变量（可重复）
  -H, --header <KEY=VALUE>    HTTP transport 自定义 header（可重复）

ys mcp remove <name>          从 .mcp.json 移除指定 server

ys mcp list                   列出 .mcp.json 中所有 server（不查运行时状态）
```

**关键约定**：

- `name` 必须匹配 `/^[a-zA-Z0-9_-]+$/`，否则报错
- 若 `commandOrUrl` 以 `http://` / `https://` 开头但 `-t` 未指定为 `http`，警告用户可能用错 transport
- `mcp list` 不查运行时连接状态（避免 IPC 复杂性），只输出配置内容
- 默认操作 `<cwd>/.mcp.json`，不支持 `--scope=user`（P2）

---

## 3. Project Structure（项目结构）

### 3.1 Phase 1 改动文件

```
src/mcp/transport.ts          # stderr: "pipe" + listener 累积写 logger
src/mcp/connection.ts         # withTimeout 增加 disconnect 调用；MCP_TIMEOUT env 支持
src/mcp/config.ts             # expandEnvVars 返回 { env, missingVars }；支持 ${VAR:-default}
src/mcp/index.ts              # 处理 missingVars warning

src/mcp/transport.test.ts     # 新增：stderr 捕获、64KB 上限
src/mcp/connection.test.ts    # 新增：timeout 后 disconnect 调用 1 次
src/mcp/config.test.ts        # 新增：missing var warn、default 语法
```

### 3.2 Phase 2 新增 / 改动

```
src/mcp/types.ts              # 增加 McpServerState discriminated union
src/mcp/connection.ts         # ConnectionManager 重构：Map<name, McpServerState> + reconnect()
src/mcp/state.ts              # 状态机转换辅助（transitionTo 等纯函数）

src/mcp/state.test.ts         # 新增：状态转换矩阵
src/mcp/connection.test.ts    # 扩展：退避序列、HTTP onclose 触发重连
```

### 3.3 Phase 3 新增

```
src/mcp/utils.ts              # jsonSchemaToTypeBox 扩展 combinator/format/pattern/const/nullable
src/mcp/__fixtures__/
  filesystem-inputs.json      # 真实 MCP server schema fixture

src/commands/mcp/
  index.ts                    # 子命令注册入口
  add.ts                      # ys mcp add
  remove.ts                   # ys mcp remove
  list.ts                     # ys mcp list
  shared.ts                   # writeMcpJson 原子写、name 校验

src/commands/mcp/*.test.ts    # 各子命令测试
src/mcp/utils.test.ts         # 扩展：combinator / fixture 测试
src/cli.ts                    # 注册 mcp 子命令
```

### 3.4 关键抽象（Phase 2 状态机）

```ts
// src/mcp/types.ts 新增
export type McpServerState =
  | { kind: "pending"; name: string; config: McpServerConfig }
  | { kind: "connected"; name: string; connection: McpServerConnection }
  | { kind: "failed"; name: string; error: Error; attempts: number }
  | { kind: "needs-auth"; name: string; reason: string };

// 退避常量（与 cc 一致）
export const MAX_RECONNECT_ATTEMPTS = 5;
export const INITIAL_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 30000;
```

### 3.5 不在本 spec 范围

- `src/agent/`、`src/utils/logger.ts`、`src/tui/` 不动
- 不新增 npm 依赖（用 pino、fs/promises、setTimeout 等已有依赖）

---

## 4. Code Style（代码规范）

- **语言**：TypeScript，与现有 ys-code 风格一致
- **日志**：所有 MCP 相关日志走 `logger.{warn,info,debug}`，**严禁 console.log / console.error / process.stderr 直接写**
- **错误**：使用 `McpConnectionError` 等自定义类，错误信息包含 server 名称
- **状态修改**：状态机只通过 `transitionTo(currentState, nextKind, payload)` 类纯函数操作，禁止直接 mutate `state.kind`
- **CLI 输出**：用户可见的 CLI 输出走 `console.log`（这是 CLI 的正常 stdout），与 logger 区分
- **文件原子写**：`writeMcpJson` 必须 tmp 文件 + `fs.renameSync`，绝不能直接 `fs.writeFileSync` 目标文件
- **schema 转换**：未识别的 combinator（如 `if/then/else`、`$ref`）退化为 `Type.Any()` 并 `logger.debug` 记录降级
- **测试**：新增/修改函数必须有对应单测，bun test 通过

---

## 5. Testing Strategy（测试策略）

### 5.1 Phase 1 测试

**`src/mcp/transport.test.ts`**

```
test("stdio stderr 被捕获并写入 logger.warn（不污染 TTY）")
test("stderr 累积上限 64KB（避免无界增长）")
```

**`src/mcp/connection.test.ts`**

```
test("连接超时必须调用 transport.close()，防止子进程泄露")
test("MCP_TIMEOUT env 覆盖默认 30s")
```

**`src/mcp/config.test.ts`**

```
test("${VAR} 缺失时 missingVars 累积，loadMcpConfig 触发 logger.warn")
test("${VAR:-default} 在 VAR 未设时取 default")
test("缺失 env 不阻断 loadMcpConfig 返回")
```

### 5.2 Phase 2 测试

**`src/mcp/state.test.ts`**（纯状态转换）

```
test("初始 pending → connect 成功 → connected")
test("connected → transport.onclose → pending（HTTP）→ retry")
test("connected → transport.onclose → failed（stdio，不重连）")
test("HTTP 401 → needs-auth（不进入退避）")
test("重试达 MAX_RECONNECT_ATTEMPTS=5 → failed 永久")
```

**`src/mcp/connection.test.ts`** 扩展

```
test("退避序列符合 1s/2s/4s/8s/16s（指数 + 上限 30s）")
```

### 5.3 Phase 3 测试

**`src/mcp/utils.test.ts`** 扩展

```
test("oneOf → Type.Union")
test("anyOf → Type.Union")
test("allOf → Type.Intersect")
test("const → Type.Literal")
test("nullable: true → Type.Union([T, Type.Null])")
test("format/pattern 透传为 schema metadata")
test("$ref 退化为 Type.Any() 且 logger.debug 记录")
test("filesystem fixture 转换不丢顶层字段")
```

**`src/commands/mcp/*.test.ts`**

```
add.test.ts:
  - "ys mcp add demo -- echo hello 写入 .mcp.json"
  - "非法 name（含空格）被拒绝"
  - "URL 误用为 stdio command 应警告"
  - "-e KEY=VALUE 解析为 env 对象"
  - "-t http 时 url 必填"

remove.test.ts:
  - "ys mcp remove demo 移除已存在条目"
  - "移除不存在的 server 报清晰错误"

list.test.ts:
  - "输出 NAME/TRANSPORT/TARGET 三列"
  - "空配置时输出 'no MCP servers configured'"

shared.test.ts:
  - "writeMcpJson 用 tmp + rename 原子写"
```

### 5.4 CI 门禁（本 spec 不强制引入 CI 文件）

| 阶段        | 必过检查                                                              |
|-----------|-------------------------------------------------------------------|
| 每个 PR     | `bun test src/mcp/`、`bun test src/commands/mcp/`、`bun run typecheck` |
| Phase 3 后 | fixture 测试覆盖至少 5 个真实 MCP server schema                            |

**不引入**：启真实 MCP server 的 e2e 测试（成本高、网络依赖），用 mock transport / 子进程模拟覆盖。

---

## 6. Boundaries（边界）

### 6.1 Always Do（每次提交都遵守）

1. **stderr 必须经 logger（pino 写文件），永不直接写 TTY/process.stderr**
   - 依据：SOP-001 硬约束（"禁止通过修改 `.mcp.json` 传参来抑制特定 server 的输出"，不得污染 TUI）
2. **任何 `transport.close()` 失败必须 catch 吞掉**
   - 依据：cc `client.ts:L1048-L1066` 用 `.catch(() => {})`；断开操作不应再次抛错掩盖原始 timeout 错误
3. **新增 / 修改 MCP 模块必须有对应 bun test，且本地通过**
4. **`.mcp.json` 写入必须原子（tmp + rename）**
   - 依据：cc `config.ts:L88-L131`；多进程并发 partial write 会导致 CLI 启不来
5. **状态变化必须经状态机方法，禁止外部直接 mutate `state.kind`**
6. **CLI 注册前必须做 name 合法性校验（`/^[a-zA-Z0-9_-]+$/`）**

### 6.2 Ask First（拿不准就问）

1. **`MCP_TIMEOUT` 默认值是否要从 30s 调整？** 当前 30s（与 cc 对齐），有 server 慢启动场景再讨论
2. **是否要支持 user/local scope 的配置文件？** 当前 spec 只 project scope，user scope 留 P2
3. **`needs-auth` 状态触发后是否要给 TUI 提示？** Phase 2 只识别 401 设状态，不实现 UI 提示
4. **重连失败 5 次后是否要允许手动重连？** Phase 2 暂不提供 `ys mcp reconnect <name>`
5. **`oneOf`/`anyOf` 是否要做严格的 discriminator 校验？** 当前用 `Type.Union` 宽松匹配，如 SDK 校验失败再切

### 6.3 Never Do（红线）

1. **❌ 永不 `stderr: 'inherit'`** — 子进程 stderr 会直接污染 TUI，破坏 Ink 渲染
2. **❌ 永不在 MCP 调用路径 console.log / console.error** — 所有日志走 `logger` → 文件
3. **❌ 永不静默吞 env 缺失错误** — cc 累积 missingVars 后告警；ys 必须至少 `logger.warn`
4. **❌ 永不省略 connect 超时后的 `transport.close()`** — 子进程 / socket 泄露是长会话最痛的内存 / 句柄 bug
5. **❌ 永不在状态机外部直接修改 `state.kind`** — 用 `transitionTo(state, "failed", error)` 之类方法
6. **❌ 永不为了让测试过而 mock 真实的 MCP server stderr 行为** — 用 `sh -c 'echo ... 1>&2'` 等真实子进程，避免假绿
7. **❌ 永不修改超出本 spec 范围的文件** — 不顺手重构 `src/agent/`、`src/utils/logger.ts`；如必要单独 PR
8. **❌ 永不引入新的 npm 依赖** — CLAUDE.md 已锁定核心依赖；用 pino、fs/promises、setTimeout 等已有依赖实现
9. **❌ 永不为 P2 项（user scope / OAuth / reconnect 命令）预留半成品代码** — 按 spec 严格分阶段交付

---

## 7. References（参考）

### 7.1 cc 关键文件证据

| 关注点    | cc 文件                                                                    | 关键行                 |
|--------|--------------------------------------------------------------------------|---------------------|
| stderr 累积 | `claude-code-haha/src/services/mcp/client.ts`                            | L957, L966-L982     |
| connect timeout | `claude-code-haha/src/services/mcp/client.ts`                            | L1048-L1066         |
| env 展开   | `claude-code-haha/src/services/mcp/envExpansion.ts`                      | L24-L31             |
| 5 状态机   | `claude-code-haha/src/services/mcp/types.ts`                             | 全文                  |
| 退避重连   | `claude-code-haha/src/services/mcp/useManageMCPConnections.ts`           | L87-L90, L371-L460  |
| 原子写    | `claude-code-haha/src/services/mcp/config.ts`                            | L88-L131            |
| CLI add | `claude-code-haha/src/commands/mcp/addCommand.ts`                        | L33-L279            |

### 7.2 ys-code 当前实现

| 关注点    | ys 文件                                                  | 关键行             |
|--------|--------------------------------------------------------|-----------------|
| stderr ignore | `src/mcp/transport.ts`                                 | L33             |
| timeout 不清理 | `src/mcp/connection.ts`                                | L8-L15          |
| env 空串兜底 | `src/mcp/config.ts`                                    | L91             |
| schema 退化 | `src/mcp/utils.ts`                                     | L51             |

### 7.3 历史 SOP

- `sop/sop-20260513-001-mcp-tui-integration.md` — stderr 不得污染 TUI 的硬约束
