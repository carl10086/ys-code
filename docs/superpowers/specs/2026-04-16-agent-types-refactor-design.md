# agent/types.ts 彻底规范化重构设计

## 1. 目标

对 `src/agent/types.ts` 进行彻底的注释规范化，统一注释风格，补全缺失的中文注释。

## 2. 变更范围

### 2.1 ThinkingLevel 枚举值注释

为每个枚举值添加中文注释说明含义：

| 枚举值 | 注释 |
|--------|------|
| `"off"` | 不使用 thinking |
| `"minimal"` | 极简 thinking，仅最终答案 |
| `"low"` | 低级别 thinking |
| `"medium"` | 中等级别 thinking（平衡速度和深度） |
| `"high"` | 高级别 thinking（更深入分析） |
| `"xhigh"` | 极高 thinking（最深度推理） |

### 2.2 AgentTool.execute 参数注释

为 `execute` 函数各参数添加注释：

| 参数 | 注释 |
|------|------|
| `toolCallId` | 工具调用唯一标识 |
| `params` | 经过 prepareArguments 处理后的参数 |
| `signal` | 可选的 abort 信号 |
| `onUpdate` | 可选的进度回调 |

### 2.3 AgentLoopConfig 字段注释

为每个字段添加详细注释：

| 字段 | 注释 |
|------|------|
| `model` | 使用的 AI 模型 |
| `convertToLlm` | 将 Agent 消息转换为 LLM 消息格式 |
| `transformContext` | 可选的消息转换/过滤函数 |
| `getApiKey` | 可选的自定义 API Key 获取函数 |
| `getSteeringMessages` | 可选的引导消息获取函数 |
| `getFollowUpMessages` | 可选的后续消息获取函数 |
| `toolExecution` | 工具执行模式（sequential/parallel） |
| `beforeToolCall` | 工具执行前的钩子，可阻止或修改行为 |
| `afterToolCall` | 工具执行后的钩子，可覆盖结果 |

### 2.4 AgentEvent 类型注释

为 union 内每个事件类型添加独立注释。

### 2.5 TDetails 类型约束

将 `TDetails = any` 改为 `TDetails = unknown`，并在接口注释中说明。

### 2.6 注释风格统一

- 统一使用 `/** 中文 */` 格式
- 字段注释统一在字段上方
- 接口/类型注释在声明上方

## 3. 不变更项

- 不改变任何类型、接口、导出顺序
- 不改变任何类型定义结构
- 不添加新类型或新字段

## 4. 风险评估

| 风险 | 缓解措施 |
|------|---------|
| 注释改动引入错误 | 仅文本改动，无结构变更 |
| 注释风格不一致 | 按本设计文档统一执行 |

## 5. 验收标准

- 所有导出类型、接口、字段都有中文注释
- 注释风格统一为 `/** 中文 */` 格式
- `TDetails` 类型约束从 `any` 改为 `unknown`
