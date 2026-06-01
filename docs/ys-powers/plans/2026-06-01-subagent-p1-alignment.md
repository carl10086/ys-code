# Subagent P1 对齐迭代计划

## Spec 来源

`docs/ys-powers/specs/2026-06-01-subagent-p1-alignment-design.md`

## 依赖图

```
┌─────────────────┐     ┌─────────────────┐
│  extract-result │     │ create-subagent │
│     (新增)      │     │   (修改)        │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
              ┌──────▼──────┐
              │  agent-tool │
              │   (修改)    │
              └──────┬──────┘
                     │
              ┌──────▼──────┐
              │   回归测试   │
              └─────────────┘
```

- **extract-result**：纯函数模块，无外部依赖，可独立开发
- **create-subagent**：依赖 `Agent` 类，不依赖 extract-result，可独立开发
- **agent-tool**：依赖 extract-result + create-subagent，必须在 slice 1/2 之后
- **回归测试**：依赖全部 slice 完成

## 任务切片（垂直，每条一个可交付的完整路径）

### Slice 1: 结果提取模块

**新增文件：**
- `src/agent/subagent/extract-result.ts`
- `src/agent/subagent/extract-result.test.ts`

**步骤：**
1. 写测试（RED）— `extract-result.test.ts` 6 个测试用例
2. 实现 `extractSubagentResult` 函数（GREEN）
3. 运行测试验证 → `bun test src/agent/subagent/extract-result.test.ts`
4. 提交

**验收标准：**
- [ ] `smart` 模式正确回溯到有实质内容的 assistant 消息
- [ ] `lastText` 模式与现有行为一致
- [ ] `allAssistantText` 模式合并所有 assistant 文本
- [ ] 无 assistant 消息时返回空字符串
- [ ] 只有 toolCall 无文本的 assistant 正确回溯
- [ ] 全部 6 个测试通过

### Slice 2: 工具池过滤

**修改文件：**
- `src/agent/subagent/create-subagent.ts`
- `src/agent/subagent/create-subagent.test.ts`

**步骤：**
1. 写测试（RED）— `create-subagent.test.ts` 新增 3 个测试用例
2. 修改 `createSubagent` 支持 `CreateSubagentOptions`（GREEN）
3. 运行测试验证 → `bun test src/agent/subagent/create-subagent.test.ts`
4. 提交

**验收标准：**
- [ ] `allowedToolNames` 正确过滤工具列表
- [ ] `allowedToolNames` 包含 "Agent" 时仍被过滤（防旧闭包）
- [ ] `systemPrompt` 选项正确覆盖父代理系统提示
- [ ] 不传 options 时行为与之前一致（向后兼容）
- [ ] 全部现有 + 新增测试通过

---

**Checkpoint 1**：Slice 1 + 2 完成后，确认基础模块就绪，extract-result 和 create-subagent 可独立工作。

验证：
```bash
bun test src/agent/subagent/
```

---

### Slice 3: AgentTool 集成

**修改文件：**
- `src/agent/tools/agent-tool.ts`
- `src/agent/tools/agent-tool.test.ts`

**步骤：**
1. 写测试（RED）— `agent-tool.test.ts` 新增 3 个测试用例（smart 提取、onUpdate 回调、无文本回退）
2. 修改 `agent-tool.ts`：
   - 引入 `extractSubagentResult` 替换现有提取逻辑
   - 订阅子代理 `AgentEvent` 并通过 `onUpdate` 转发 assistant 消息
   - （可选）传入 `allowedToolNames` 到 `createSubagent`
3. 运行测试验证 → `bun test src/agent/tools/agent-tool.test.ts`
4. 提交

**验收标准：**
- [ ] 使用 `smart` 模式提取子代理结果
- [ ] `onUpdate` 回调在子代理产生 assistant 消息时被触发
- [ ] 子代理无文本回复时返回 `"No text response from subagent"`
- [ ] 全部现有 14 个测试仍通过（无回归）
- [ ] 新增 3 个测试通过

### Slice 4: 回归验证

**步骤：**
1. 运行全部 agent 相关测试
2. 确认无编译错误

**验收标准：**
- [ ] `bun test src/agent/` 全部通过
- [ ] `bun test src/agent/tools/agent-tool.test.ts` 通过
- [ ] `bun test src/agent/subagent/` 通过
- [ ] `bun test src/agent/agent-loop.test.ts` 通过
- [ ] `bun test src/agent/tool-execution.test.ts` 通过

---

**Checkpoint 2**：全部 slice 完成后，确认无回归，准备 PR。

---

## 执行顺序

```
Slice 1 ──┐
          ├──→ Checkpoint 1 ──→ Slice 3 ──→ Checkpoint 2 ──→ PR
Slice 2 ──┘                          ↑
                                Slice 4（回归）
```

Slice 1 和 Slice 2 可并行开发，Slice 3 依赖 1+2，Slice 4 为最终验证。

## 风险与回退策略

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `extractSubagentResult` 的 smart 模式阈值（20字符）不合理 | 结果提取仍不准确 | 阈值可配置，通过测试用例验证典型场景 |
| `Agent.subscribe()` 在子代理执行期间的事件频率过高 | 性能或 UI 抖动 | 仅转发 `message_end` + `role === "assistant"`，频率可控 |
| `allowedToolNames` 破坏现有向后兼容 | 现有测试失败 | 默认行为（不传 options）必须保持完全一致 |

## 预计工作量

| Slice | 预计时间 | 文件数 |
|-------|----------|--------|
| 1. 结果提取 | 30 min | 2 新增 |
| 2. 工具过滤 | 20 min | 2 修改 |
| 3. AgentTool 集成 | 30 min | 2 修改 |
| 4. 回归验证 | 10 min | — |
| **总计** | **~90 min** | **6 文件** |
