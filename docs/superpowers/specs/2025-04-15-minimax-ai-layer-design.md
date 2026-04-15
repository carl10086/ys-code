# MiniMax AI 层设计文档

## 目标

将 `pi-mono/packages/ai` 的完整抽象层移植到 `ys-code` 项目中，**仅保留 MiniMax provider 支持**，保留后续扩展其他 provider 的能力。

## 设计原则

1. **架构对齐**：保留 pi-mono 的通用抽象（类型、注册表、事件流、模型系统）。
2. **最小裁剪**：仅删除与 MiniMax 无关的 provider 实现、CLI、OAuth、测试和模型生成脚本。
3. **路径映射**：源码目录从 `src/ai` 调整为 `src/core/ai`，以适配 ys-code 的目录规划。

## 目录结构

```
src/
  core/
    ai/
      index.ts                      # 统一导出
      types.ts                      # 消息、模型、流选项等类型定义
      api-registry.ts               # API provider 注册表（按 api 类型注册）
      stream.ts                     # stream / complete / streamSimple / completeSimple
      models.ts                     # 模型注册表 API（getModel / getModels / calculateCost）
      models.generated.ts           # 仅包含 minimax / minimax-cn 的模型定义
      env-api-keys.ts               # 仅 minimax / minimax-cn 的 API key 环境变量映射
      providers/
        anthropic.ts                # Anthropic Messages API provider（MiniMax 兼容此协议）
        register-builtins.ts        # 懒加载注册 anthropic-messages provider
        simple-options.ts           # 通用流选项构建工具
        transform-messages.ts       # 跨 provider 消息转换与规范化
      utils/
        event-stream.ts             # AssistantMessageEventStream 异步事件流实现
        json-parse.ts               # 流式 JSON 解析（partial-json）
        validation.ts               # 基于 AJV 的工具参数校验
        sanitize-unicode.ts         # 去除未配对 Unicode surrogate
        hash.ts                     # 短哈希工具
        overflow.ts                 # 上下文溢出错误检测
```

## 数据流

```
用户代码
    |
    v
streamSimple(model, context, options)
    |
    v
api-registry.ts 查找 model.api (anthropic-messages)
    |
    v
register-builtins.ts 懒加载 providers/anthropic.ts
    |
    v
anthropic.ts 构建 Anthropic SDK 参数并发起 SSE 请求
    |
    v
逐事件解析，push 到 AssistantMessageEventStream
    |
    v
用户通过 for await 或 await stream.result() 消费结果
```

## 依赖变更

需要在 `package.json` 中新增以下依赖：

- `@anthropic-ai/sdk`：调用 MiniMax 的 Anthropic-compatible API
- `@sinclair/typebox`：Tool 参数定义（与 pi-mono 保持一致）
- `ajv` + `ajv-formats`：工具参数校验
- `partial-json`：流式 JSON 解析

## MiniMax Provider 配置

### API 协议

MiniMax 通过 Anthropic Messages API 协议暴露服务，因此 `model.api` 为 `"anthropic-messages"`，由 `providers/anthropic.ts` 统一处理。

### Base URL

| provider | baseUrl |
|----------|---------|
| `minimax` | `https://api.minimax.io/anthropic` |
| `minimax-cn` | `https://api.minimaxi.com/anthropic` |

### 认证

仅支持 API Key，环境变量映射：

- `minimax` → `MINIMAX_API_KEY`
- `minimax-cn` → `MINIMAX_CN_API_KEY`

不支持 OAuth。

### 模型列表

`models.generated.ts` 中仅注册以下模型：

| 模型 ID | 名称 | provider | 上下文窗口 | maxTokens |
|---------|------|----------|-----------|-----------|
| `MiniMax-M2.7` | MiniMax-M2.7 | minimax / minimax-cn | 204800 | 131072 |
| `MiniMax-M2.7-highspeed` | MiniMax-M2.7-highspeed | minimax / minimax-cn | 204800 | 131072 |

模型属性：`api: "anthropic-messages"`，`reasoning: true`，`input: ["text"]`。

## 错误处理

沿用 pi-mono 的流式错误契约：

- **运行时错误**（网络、API 4xx/5xx）：不抛异常，以 `error` 终止事件推入流中，携带 `stopReason: "error"`。
- **主动取消**（AbortSignal）：以 `error` 终止事件推入流中，携带 `stopReason: "aborted"`。
- **上下文溢出**：`utils/overflow.ts` 包含 MiniMax 的错误模式匹配（`context window exceeds limit`）。

## 裁剪内容

以下 pi-mono `packages/ai` 内容**不迁移**：

- 所有非 MiniMax provider 实现（openai / google / mistral / azure / bedrock 等）
- `cli.ts`（模型列表 CLI）
- `bedrock-provider.ts` 及 `amazon-bedrock.ts`
- `utils/oauth/` 整个目录（OAuth 实现）
- `scripts/` 目录（模型自动生成脚本）
- `test/` 目录（测试文件）
- `models.generated.ts` 中其他 provider 的模型定义

## 接口兼容性

对外导出接口保持与 pi-mono 一致，方便后续同步：

```ts
// 获取模型
const model = getModel("minimax", "MiniMax-M2.7");

// 流式调用
const stream = streamSimple(model, context, { reasoning: "medium" });
for await (const event of stream) { /* ... */ }

// 或等待完整结果
const message = await completeSimple(model, context);
```
