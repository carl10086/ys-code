# 与 claude-code-haha 的差异对比

> 来源：docs/cc/2026-04-23-cc-EditTool-源码分析.md
> 日期：2026-04-24

---

## 功能对齐度

| 功能 | cc | ys-code | 状态 |
|------|-----|---------|------|
| 先读后写 | ✅ | ✅ | **已对齐** |
| 脏写检测（双层） | ✅ | ✅ | **已对齐** |
| 引号规范化 | ✅ | ✅ | **已对齐** |
| FileStateCache (LRU) | ✅ | ✅ | **已对齐** |
| 错误码体系 | 0-10 | 1,3,4,6,7,8,9 | 部分对齐 |
| LSP 诊断通知 | ✅ | ❌ | 未实现 |
| 文件历史备份 | ✅ | ❌ | 未实现 |
| settings 文件校验 | ✅ | ❌ | 未实现 |
| Notebook 保护 | ✅ | ❌ | 未实现 |
| 权限系统 | ✅ | ❌ | 未实现 |
| UNC 路径安全 | ✅ | ❌ | 未实现 |
| 团队内存 secrets 检查 | ✅ | ❌ | 未实现 |

## 已引入机制的决策记录

### 为什么选择 LRUCache 而不是 Map

**选项 A：Map（轻量级）**
- 优点：无额外依赖，代码简单
- 缺点：无内存上限，长时间运行可能 OOM

**选项 B：LRUCache（cc 同款）**
- 优点：内存受限，自动淘汰，与 cc 对齐
- 缺点：需要 `lru-cache` 依赖

**决策**：选择 LRUCache。Agent 会话可能持续数小时，读取数百个文件，Map 会导致内存泄漏。

### 为什么使用 ToolUseContext 注入 FileStateCache

**选项 A：工厂参数注入（早期设计）**
- `session.ts` 创建 tracker，通过工厂函数参数传给 ReadTool/EditTool
- 优点：修改面小，只改 3 个文件
- 缺点：子 Agent 无法共享读取记录

**选项 B：ToolUseContext 注入（最终设计）**
- FileStateCache 放入 `ToolUseContext`，所有工具共享
- 优点：子 Agent 可继承，与 cc 的 `toolUseContext.readFileState` 对齐
- 缺点：需要修改 `defineAgentTool` 和 `AgentLoopConfig`

**决策**：选择 ToolUseContext 注入。为后续子 Agent 共享状态预留空间。

### 为什么 errorCode 用 6 和 7

直接沿用 cc 的错误码体系，保持语义一致：
- 6 = 文件未读取（cc 同款）
- 7 = 文件被修改（cc 同款）

这样当模型从 cc 迁移到 ys-code 时，对错误码的理解不变。

## 尚未引入的机制

### LSP 通知
cc 在编辑后通知 LSP 服务器更新诊断：
```typescript
lspManager.changeFile(absoluteFilePath, updatedFile).catch(...)
lspManager.saveFile(absoluteFilePath).catch(...)
```
ys-code 当前无 LSP 集成，暂不需要。

### 文件历史备份
c 在编辑前备份文件历史，支持恢复：
```typescript
await fileHistoryTrackEdit(updateFileHistoryState, absoluteFilePath, parentMessage.uuid)
```
ys-code 当前依赖 git 做版本控制，暂不需要内置备份。

### Notebook 保护
c 禁止直接编辑 `.ipynb` 文件：
```typescript
if (fullFilePath.endsWith('.ipynb')) {
  return { result: false, message: 'Use NotebookEditTool', errorCode: 5 }
}
```
ys-code 当前无 NotebookEditTool，暂不需要。

## 演进方向

高优先级：
1. 脏写检测的集成测试（需要文件系统时间操作）
2. WriteTool 的覆盖检查（覆盖已有文件时要求先读取）

中优先级：
1. 文件大小限制（1GB 防 OOM）
2. settings 文件特殊校验

低优先级：
1. LSP 通知集成
2. 文件历史备份
