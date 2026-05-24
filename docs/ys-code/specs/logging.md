# ys-code 日志系统设计

## 1. 设计目标

为 `ys-code` 提供一套统一、非侵入式、人类可读的日志系统：

- **debug 级别**：开发排错使用（API 请求/响应详情、内部状态变化）
- **info 级别**：用户可见的运行记录（会话开始/结束、工具调用摘要）
- **warn/error 级别**：异常与错误记录
- **完全不干扰 TUI**：日志写入文件，不在 stdout 输出，避免破坏 Ink 界面

## 2. 架构设计

### 2.1 技术选型：pino + pino-pretty

选择 `pino` 的理由：

- **性能最优**：Bun/Node 生态中基准测试领先的日志库
- **非阻塞**：transport 在 worker thread 中运行，主线程只做最小化 JSON 序列化，不影响 TUI 渲染响应性
- **Bun 兼容**：经过社区广泛验证，Bun 兼容性良好
- **生态成熟**：`pino-pretty` 负责格式化，`pino/file` 负责文件输出，组合灵活

```
┌─────────────────────────────────────────┐
│           ys-code 主进程                 │
│  ┌──────────────┐   ┌────────────────┐  │
│  │ 业务代码     │──▶│ pino (主线程)  │  │
│  │ (agent/tui)  │   │ 生成 JSON 日志  │  │
│  └──────────────┘   └────────────────┘  │
│            │ 通过 MessageChannel          │
│            ▼                            │
│  ┌────────────────────────────────────┐ │
│  │ pino-pretty transport (worker)     │ │
│  │ 格式化为人类可读文本 ──▶ ys-code.log │ │
│  └────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 2.2 核心模块

**`src/utils/logger.ts`**：单例 Logger，所有业务代码统一导入使用。

```typescript
import pino from 'pino';

const transport = pino.transport({
  target: 'pino-pretty',
  options: {
    destination: './ys-code.log',
    append: true,
    colorize: false,
    translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
    ignore: 'pid,hostname',
  }
});

export const logger = pino({
  level: process.env.YS_LOG_LEVEL || 'info',
}, transport);

// 进程退出时优雅关闭
process.on('beforeExit', () => {
  transport.end?.();
});
```

## 3. 日志级别与使用场景

| 级别 | 使用场景 | 示例 |
|------|---------|------|
| `debug` | 开发排错信息 | API 请求/响应详情、内部状态变化、工具参数 |
| `info` | 用户可见的运行记录 | 会话开始/结束、工具调用摘要、用户操作 |
| `warn` | 非致命异常 | 网络重试、降级行为、配置缺失但可恢复 |
| `error` | 致命错误 | 未捕获异常、API 调用完全失败、文件不可读 |

**使用示例**：

```typescript
import { logger } from '../utils/logger.js';

logger.info('用户启动了会话');
logger.debug({ tool: 'read', file: 'src/main.ts' }, '调用工具');
logger.error(err, 'API 调用失败');
```

**输出示例**：

```
[2025-04-19 14:30:25] INFO: 用户启动了会话
[2025-04-19 14:30:26] DEBUG: 调用工具
[2025-04-19 14:30:27] ERROR: API 调用失败
```

## 4. 生命周期与错误处理

### 4.1 进程退出

通过 `process.on('beforeExit')` 在进程退出前调用 `transport.end()`，确保缓冲中的日志落盘。

### 4.2 错误场景

| 场景 | 行为 | 对 TUI 影响 |
|------|------|-----------|
| 文件不可写（无权限、只读目录） | worker thread 静默丢弃，不抛异常到主线程 | 无影响 |
| 磁盘满 | worker thread 静默丢弃 | 无影响 |
| 进程异常崩溃 | 缓冲中最后 1-2 条可能丢失，其余已落盘 | 无影响 |
| 日志级别过滤（如 debug 被过滤） | 主线程直接跳过序列化，零开销 | 无影响 |

## 5. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `YS_LOG_LEVEL` | `info` | 控制日志级别：`debug` / `info` / `warn` / `error` / `silent` |

## 6. 迁移计划

替换现有 `console.*` 调用：

| 文件 | 当前代码 | 替换为 |
|------|---------|--------|
| `src/core/ai/utils/validation.ts` | `console.warn(...)` | `logger.warn(...)` |
| `src/tui/index.tsx` | `console.error(...)` | `logger.error(...)` |
| `src/agent/tools/read/image.ts` | `console.warn(...)` | `logger.warn(...)` |
| `src/agent/system-prompt/systemPrompt.ts` | `console.warn(...)` | `logger.warn(...)` |

**后续规范**：新代码统一使用 `import { logger } from '../utils/logger.js'`（路径根据实际调整），不再直接使用 `console.*`。

## 7. 依赖

新增运行时依赖：

- `pino`: ^9.x（核心日志库）
- `pino-pretty`: ^11.x（格式化 transport）
