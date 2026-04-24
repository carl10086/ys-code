# 错误处理

> 分析对象：src/agent/tools/edit.ts @ da24438

---

## 错误码对照表

| 错误码 | 触发场景 | 消息示例 | 恢复路径 |
|--------|---------|---------|---------|
| 1 | `old_string === new_string` | "No changes to make..." | 检查输入是否有变化 |
| 3 | 文件存在但 `old_string` 为空 | "Cannot create new file..." | 使用 WriteTool 或提供 old_string |
| 4 | 文件不存在且 `old_string` 非空 | "File does not exist..." | 使用 WriteTool 创建文件 |
| 6 | 文件未读取或部分读取 | "File has not been read yet..." | 调用 ReadTool 读取 |
| 7 | 文件在读取后被外部修改 | "File has been modified since read..." | 调用 ReadTool 重新读取 |
| 8 | `old_string` 找不到 | "String to replace not found..." | 检查 old_string 是否正确 |
| 9 | 多匹配但 `replace_all=false` | "Found N matches..." | 扩大上下文或启用 replace_all |

## 新增错误码决策记录

### 为什么用 6 和 7

沿用 cc 的错误码体系，避免冲突：
- 错误码 6：文件未读取 / 部分读取
- 错误码 7：文件被外部修改

这两个错误码在 cc 中已存在，ys-code 直接复用以保持语义一致。

### 为什么未引入 2/5/10

| 错误码 | cc 用途 | ys-code 未引入原因 |
|--------|---------|-------------------|
| 2 | 权限规则 deny | 当前无权限系统 |
| 5 | Jupyter Notebook | 当前无 NotebookEditTool |
| 10 | 文件超过 1GB | 当前无文件大小限制 |

## 错误恢复路径

### 错误码 6 的恢复

```
EditTool 返回错误码 6
    |
    v
模型调用 ReadTool 读取该文件（全量）
    |
    v
ReadTool.execute 中调用 recordRead()
    |
    v
模型再次调用 EditTool
    |
    v
canEdit() 通过
```

### 错误码 7 的恢复

与错误码 6 类似，但 ReadTool 读取的是**最新内容**（外部修改后的）。

### 错误码 8/9 的恢复

- 错误码 8：检查 `old_string` 是否与文件内容完全匹配（包括空格、缩进）
- 错误码 9：扩大 `old_string` 的上下文范围，使其唯一；或设置 `replace_all: true`
