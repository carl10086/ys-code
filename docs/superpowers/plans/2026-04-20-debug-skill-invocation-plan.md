# Debug Skill Invocation Example 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标**：创建 `examples/debug-skill-invocation.ts`，完整追踪一次 skill 调用的完整调用链。

**架构**：基于 `debug-agent-chat.ts` 改造，增加 skill 目录扫描和调用链 debug 输出。SkillTool.execute 的调试通过在 src 代码中设置断点完成，example 仅负责触发流程和格式化输出。

**技术栈**：Bun, TypeScript, Ink, React

---

## Task 1: 创建 debug-skill-invocation.ts

**Files:**
- Create: `examples/debug-skill-invocation.ts`
- Reference: `examples/debug-agent-chat.ts`
- Reference: `src/agent/session.ts:83-97` (SkillTool 初始化)
- Reference: `src/agent/tools/skill.ts` (SkillTool 实现)

### 步骤 1: 创建基础文件

复制 `debug-agent-chat.ts` 作为基础，保留所有导入和事件监听结构。

### 步骤 2: 添加 skill 目录扫描

在 main() 函数开头添加 skill 扫描逻辑：

```typescript
import { getCommands } from "../src/commands/index.js";
import { join } from "node:path";

async function listAvailableSkills() {
  const skillsBasePath = join(process.cwd(), ".claude/skills");
  const commands = await getCommands(skillsBasePath);
  const promptCommands = commands.filter(cmd => cmd.type === "prompt");

  console.log("\n[DEBUG] Available skills:");
  for (const cmd of promptCommands) {
    console.log(`  - ${cmd.name}`);
  }
  console.log();
}
```

### 步骤 3: 修改输入处理

将 `inputs` 数组改为动态读取，用户输入 "执行 &lt;skill-name&gt; skill" 时调用对应 skill。

### 步骤 4: 验证运行

- [ ] 运行: `bun run examples/debug-skill-invocation.ts`
- [ ] 确认 skill 列表正确显示
- [ ] 确认 AgentSession 初始化成功
- [ ] 确认 steer + prompt 流程正常

### 步骤 5: 提交

```bash
git add examples/debug-skill-invocation.ts
git commit -m "feat: add debug-skill-invocation example"
```

---

## 验证步骤

1. 运行 `bun run examples/debug-skill-invocation.ts`
2. 确认控制台输出可用 skill 列表
3. 输入 "执行 brainstorming skill"
4. 观察完整对话流程
5. 在 `src/agent/tools/skill.ts:40-82` 设置断点，验证 SkillTool.execute 调用链
