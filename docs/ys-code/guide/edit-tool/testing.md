# 测试覆盖

> 分析对象：src/agent/file-state.test.ts @ da24438, src/agent/tools/edit.test.ts @ da24438

---

## 测试矩阵

### FileStateCache 测试（16 个）

| 测试名 | 覆盖场景 |
|--------|---------|
| 全量读取后应允许编辑 | canEdit 返回 ok: true |
| 未读取文件应拒绝编辑 | canEdit 返回 errorCode: 6 |
| 部分视图应拒绝编辑 | isPartialView=true 时拒绝 |
| 部分读取（offset 有值）应拒绝编辑 | offset !== undefined 时拒绝 |
| 部分读取（limit 有值）应拒绝编辑 | limit !== undefined 时拒绝 |
| 编辑后应更新记录 | recordEdit 更新 content/timestamp/offset/limit |
| 编辑后连续编辑无需重新读取 | recordEdit 后 canEdit 直接通过 |
| 路径应规范化 | normalize(path) 生效 |
| LRU 应自动淘汰旧项 | maxEntries 限制生效 |
| LRU 按大小淘汰 | maxSizeBytes + sizeCalculation 生效 |
| clear() 清除所有记录 | clear 后 get/canEdit 均失效 |
| get() 获取未记录文件返回 undefined | 未缓存路径 |
| 多次读取同一文件覆盖更新 | 后写入的覆盖先写入的 |
| recordRead 默认值检查 | isPartialView=false, offset/limit=undefined |
| canEdit 返回的 record 完整性 | 返回 record 包含全部字段 |
| recordEdit 后 isPartialView 强制为 false | 覆盖之前可能的 true |

### EditTool 集成测试（6 个）

| 测试名 | 覆盖场景 |
|--------|---------|
| 未读取文件应拒绝编辑 | validateInput 返回 errorCode: 6 |
| 读取后应允许编辑 | validateInput 返回 ok: true |
| 编辑后应更新缓存 | execute 中调用 recordEdit |
| curly quotes 匹配 | findActualString 规范化匹配 |
| curly quotes 风格保留 | preserveQuoteStyle 生效 |
| straight quotes 回退 | 无 curly quotes 时正常处理 |

## 未覆盖场景

| 场景 | 未覆盖原因 | 风险等级 |
|------|-----------|---------|
| 脏写检测触发（错误码 7） | 需要操作文件 mtime，测试复杂 | 低（逻辑简单，有源码验证） |
| 二次脏写检测抛出异常 | 同上 | 低 |
| replace_all=true 多替换 | 逻辑简单，有源码验证 | 低 |
| 文件不存在创建（old_string=""） | 基础功能，有源码验证 | 低 |

## 测试设计原则

1. **纯逻辑测试**：FileStateCache 测试完全 mock，无文件系统依赖
2. **集成测试**：EditTool 测试使用临时文件，覆盖完整调用链路
3. **边界覆盖**：部分读取、LRU 淘汰、默认值等边界场景均有覆盖
