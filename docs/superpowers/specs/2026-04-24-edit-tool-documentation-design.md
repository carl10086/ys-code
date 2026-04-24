# EditTool 文档体系设计

> 日期：2026-04-24
> 目标：在 `docs/details/edit-tool/` 建立完整的 EditTool 技术文档体系
> 定位：源码分析 + 技术参考手册 + 演进决策记录

---

## 1. 设计目标

1. **汇总分散文档**：将现有分布在 `docs/cc/`、`docs/plan/`、`docs/superpowers/` 中的 EditTool 相关文档统一归档
2. **逐行源码分析**：从当前 `src/agent/tools/edit.ts`、`src/agent/file-state.ts` 等源码出发，逐模块、逐函数解析实现细节
3. **技术参考手册**：为后续继续演进 EditTool 提供可查询的技术依据，包括安全机制、错误处理、测试覆盖等

---

## 2. 目录结构

```
docs/details/edit-tool/
├── README.md                    # 总览、架构图、文件索引
├── 01-execution-flow.md         # 完整执行时序
├── 02-read-before-write.md      # 先读后写机制
├── 03-dirty-write-detection.md  # 脏写检测（双层）
├── 04-quote-normalization.md    # 引号规范化
├── 05-file-state-cache.md       # FileStateCache 设计与实现
├── 06-error-handling.md         # 错误码体系
├── 07-testing.md                # 测试覆盖分析
└── 08-cc-comparison.md          # 与 cc 的差异与演进决策
```

---

## 3. 各文件内容大纲

### `README.md`

- EditTool 的职责一句话定义
- 架构图（Mermaid 时序图或数据流图）
- 8 个文档的索引与一句话摘要
- 与现有文档的关系说明（引用 docs/cc/ 等外部文档）

### `01-execution-flow.md`

- 一次 Edit 调用的完整时序（从模型发起到文件写入）
- `validateInput` 阶段：做了什么、返回什么、副作用
- `execute` 阶段：做了什么、副作用
- 两次脏写检测的时间点对比（图）
- 与 ReadTool、FileStateCache 的交互关系

### `02-read-before-write.md`

- 问题定义：为什么必须先 Read 才能 Edit
- FileStateCache 的读取凭证模型（不是缓存，是凭证 + 快照）
- `canEdit()` 的三种返回状态（ok / not read / partial read）
- 部分读取拒绝的理由：`offset`、`limit`、`isPartialView`
- 错误恢复路径（错误码 6）

### `03-dirty-write-detection.md`

- 问题定义：外部修改风险（Vim、IDE、linter、git）
- 第一层检测（`validateInput`）：mtime 快速检查 → content 回退对比
- 第二层检测（`execute`）：为什么需要两次检测（用户确认间隙）
- 全量读取 vs 部分读取的不同处理策略
- 误报处理（mtime 变但 content 没变，如 Windows 云同步）

### `04-quote-normalization.md`

- 问题定义：curly quotes vs straight quotes
- `normalizeQuotes`：将 curly quotes 统一替换为 straight quotes
- `findActualString`：精确匹配失败后尝试规范化匹配
- `preserveQuoteStyle`：将 new_string 中的引号转换为文件的 curly quotes 风格
- 单引号的特殊处理：apostrophe 识别（如 don't、it's）
- 为什么返回 `actualOldString` 但模型看到的是原始的 `new_string`

### `05-file-state-cache.md`

- 数据结构：`FileReadRecord` 每个字段的含义与必要性
- LRU 策略：`maxEntries` + `maxSizeBytes` + `sizeCalculation`
- 接口方法逐一说明：`recordRead`、`canEdit`、`recordEdit`、`get`、`clear`
- 与 cc 的 `FileStateCache` 对比（Map vs LRU，为什么选 LRU）

### `06-error-handling.md`

- 错误码对照表（1/3/4/6/7/8/9）
- 每种错误的触发条件、返回消息、恢复路径
- 新增错误码的决策记录（为什么用 6 和 7，为什么不引入 2/5/10）

### `07-testing.md`

- 测试矩阵：FileStateCache（16 个）+ EditTool（6 个）
- 每个测试覆盖的场景说明
- 未覆盖场景的标注与原因（如脏写检测的集成测试需要文件系统时间操作）

### `08-cc-comparison.md`

- 与 cc 的差异列表（功能对齐度）
- 已引入的机制：先读后写、脏写检测、引号规范化
- 尚未引入的机制：LSP 通知、文件历史备份、settings 文件校验、Notebook 保护
- 演进决策记录（为什么选择 LRU、为什么 errorCode 6/7、为什么使用 ToolUseContext 注入）

---

## 4. 信息来源

| 文档 | 主要来源 |
|------|---------|
| 执行时序 | `src/agent/tools/edit.ts` 源码逐行分析 |
| 安全机制 | `src/agent/file-state.ts` + `edit.ts` 整合分析 |
| 引号规范化 | `src/agent/tools/edit.ts` 顶部辅助函数 |
| 测试分析 | `src/agent/file-state.test.ts` + `edit.test.ts` |
| cc 对比 | `docs/cc/2026-04-23-cc-EditTool-源码分析.md` + `docs/cc/edit-tool-comparison.md` |
| 演进设计 | `docs/plan/2026-04-23-read-before-write-design.md` + `docs/superpowers/specs/2026-04-23-edittool-evolution-design.md` |

---

## 5. 维护约定

- 每个文档顶部标注：`> 分析对象：src/agent/tools/edit.ts @ <commit-sha>`
- 源码变更时优先更新 `01-execution-flow.md`
- 新增安全机制时按编号规则新增 `02x-xxx.md` 章节
- `08-cc-comparison.md` 仅在做出新的对齐/差异决策时更新
- 文档之间通过相对链接引用，避免信息重复

---

## 6. 非目标

- 不重复 cc 源码分析的完整内容（已在 `docs/cc/` 中）
- 不编写用户-facing 的使用文档（已在 EditTool description 中）
- 不包含尚未实现的机制设计（如 LSP 通知、文件历史备份）
