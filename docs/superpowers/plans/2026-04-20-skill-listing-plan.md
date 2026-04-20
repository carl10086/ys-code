# Skill Listing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在首次用户消息时自动将可用 skills 列表附加给 LLM，并支持增量更新。

**Architecture:** 通过在 session 层预注入 skill listing attachment 到 messages 数组，利用 `normalizeMessages` 的"向前合并"特性确保 skill listing 绑定到第一条 user message。sentSkillNames 状态维护在 AgentSession 实例。

**Tech Stack:** TypeScript, Bun

---

## 文件结构

```
src/agent/
  attachments/
    types.ts          # SkillListingAttachment 类型
    skill-listing.ts  # 新建：格式化 + 注入逻辑
    normalize.ts      # skill_listing case
  session.ts          # sentSkillNames 状态管理
  tools/
    skill.ts          # SkillTool 描述更新
```

---

## Task 1: 新增 SkillListingAttachment 类型

**Files:**
- Modify: `src/agent/attachments/types.ts:76-77`

- [ ] **Step 1: 在 types.ts 中添加 SkillListingAttachment 类型**

在 `Attachment` 联合体类型定义之前添加：

```typescript
/** Skill listing attachment - 告诉 LLM 有哪些 skills 可用 */
export interface SkillListingAttachment extends BaseAttachment {
  /** 附件类型 */
  type: "skill_listing";
  /** 格式化后的 skills 列表文本 */
  content: string;
  /** 本次包含的 skill 名称列表（用于去重） */
  skillNames: string[];
}
```

修改 `Attachment` 联合体（第 76-77 行）:

```typescript
/** 附件联合体 —— 包含 relevant_memories、file、directory、skill_listing */
export type Attachment = RelevantMemoriesAttachment | FileAttachment | DirectoryAttachment | SkillListingAttachment;
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/agent/attachments/types.ts
git commit -m "feat(attachments): add SkillListingAttachment type"
```

---

## Task 2: 创建 skill-listing.ts（格式化 + 注入逻辑）

**Files:**
- Create: `src/agent/attachments/skill-listing.ts`

- [ ] **Step 1: 创建 skill-listing.ts 文件**

```typescript
import { join } from "node:path";
import type { PromptCommand } from "../../commands/types.js";
import { getCommands } from "../../commands/index.js";
import type { AgentMessage } from "../types.js";
import type { SkillListingAttachment } from "./types.js";

/**
 * 格式化 skill 列表文本，完全复用 CC 格式
 * 格式："- name: description - whenToUse"
 */
export function formatSkillListing(commands: PromptCommand[]): string {
  return commands
    .filter((cmd) => cmd.type === "prompt")
    .map((cmd) => {
      const desc = cmd.whenToUse
        ? `${cmd.description} - ${cmd.whenToUse}`
        : cmd.description;
      return `- ${cmd.name}: ${desc}`;
    })
    .join("\n");
}

/**
 * 扫描 user message 中的 @... 引用，注入对应的 attachment 消息
 * @param messages 原始 AgentMessage 数组
 * @param cwd 当前工作目录（用于解析相对路径）
 * @returns 注入 attachment 后的新数组
 */
export async function injectSkillListingAttachments(
  messages: AgentMessage[],
  cwd: string,
): Promise<AgentMessage[]> {
  // 找到第一条 user message
  const firstUserIndex = messages.findIndex((m) => m.role === "user");
  if (firstUserIndex === -1) {
    return messages;
  }

  // 获取所有可用 skills
  const commands = await getCommands(join(cwd, ".claude/skills"));
  const promptCommands = commands.filter(
    (cmd): cmd is PromptCommand => cmd.type === "prompt",
  );

  // 获取新增 skills（由 session 的 sentSkillNames 过滤）
  // 注意：此函数只负责格式化，sentSkillNames 的管理由 session 负责
  if (promptCommands.length === 0) {
    return messages;
  }

  // 格式化
  const content = formatSkillListing(promptCommands);
  const attachment: SkillListingAttachment = {
    type: "skill_listing",
    content,
    skillNames: promptCommands.map((s) => s.name),
    timestamp: Date.now(),
  };

  // 插入到第一条 user message 之后
  return [
    ...messages.slice(0, firstUserIndex + 1),
    { role: "attachment", attachment } as AgentMessage,
    ...messages.slice(firstUserIndex + 1),
  ];
}
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/agent/attachments/skill-listing.ts
git commit -m "feat(attachments): add skill listing formatting and injection"
```

---

## Task 3: 更新 normalizeAttachment 处理 skill_listing

**Files:**
- Modify: `src/agent/attachments/normalize.ts:55-59`

- [ ] **Step 1: 添加 skill_listing case 到 normalizeAttachment**

在 `normalizeAttachment` 函数的 `default` case 之前添加：

```typescript
    case "skill_listing": {
      const content = [
        "<system-reminder>",
        "You can use the following skills:",
        "",
        attachment.content,
        "",
        "To use a skill, call the SkillTool with the skill name.",
        "</system-reminder>",
        "",
      ].join("\n");
      return [{ role: "user", content, timestamp: attachment.timestamp }];
    }
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/agent/attachments/normalize.ts
git commit -m "feat(attachments): handle skill_listing type in normalizeAttachment"
```

---

## Task 4: 更新 stream-assistant.ts 调用 injectSkillListingAttachments

**Files:**
- Modify: `src/agent/stream-assistant.ts:110-111`

- [ ] **Step 1: 在 userContext 之后、@mention 之前注入 skill listing**

将第 110-111 行：
```typescript
  // 在 userContext 之后、normalize 之前注入 @... 附件
  messages = await injectAtMentionAttachments(messages, process.cwd());
```

替换为：
```typescript
  // 在 userContext 之后、@mention 之前注入 skill listing
  messages = await injectSkillListingAttachments(messages, process.cwd());

  // 注入 @... 附件
  messages = await injectAtMentionAttachments(messages, process.cwd());
```

- [ ] **Step 2: 添加 import**

在文件顶部 import 部分添加：
```typescript
import { injectSkillListingAttachments } from "./attachments/skill-listing.js";
```

- [ ] **Step 3: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 4: Commit**

```bash
git add src/agent/stream-assistant.ts
git commit -m "feat(stream): inject skill listing before at-mention attachments"
```

---

## Task 5: AgentSession 添加 sentSkillNames 状态管理

**Files:**
- Modify: `src/agent/session.ts`

- [ ] **Step 1: 添加 sentSkillNames 私有属性**

在 `AgentSession` 类中，`private skillToolInitPromise` 之后添加：

```typescript
  /** 已发送给 LLM 的 skill 名称集合（用于去重） */
  private sentSkillNames: Set<string> = new Set();
```

- [ ] **Step 2: 添加获取和标记方法**

在 `initializeSkillTool` 方法之后添加：

```typescript
  /** 获取尚未发送的 skills */
  getNewSkills(allSkills: PromptCommand[]): PromptCommand[] {
    return allSkills.filter((s) => !this.sentSkillNames.has(s.name));
  }

  /** 标记 skills 已发送 */
  markSkillsSent(skillNames: string[]): void {
    for (const name of skillNames) {
      this.sentSkillNames.add(name);
    }
  }

  /** 获取新的 skill listing attachment（由 stream-assistant 调用） */
  async getNewSkillListingAttachment(): Promise<AgentMessage | null> {
    const commands = await getCommands(join(this.cwd, ".claude/skills"));
    const promptCommands = commands.filter(
      (cmd): cmd is PromptCommand => cmd.type === "prompt",
    );
    const newSkills = this.getNewSkills(promptCommands);
    if (newSkills.length === 0) {
      return null;
    }

    const { formatSkillListing } = await import("./attachments/skill-listing.js");
    const content = formatSkillListing(newSkills);
    const attachment: SkillListingAttachment = {
      type: "skill_listing",
      content,
      skillNames: newSkills.map((s) => s.name),
      timestamp: Date.now(),
    };

    this.markSkillsSent(newSkills.map((s) => s.name));

    return { role: "attachment", attachment } as AgentMessage;
  }
```

- [ ] **Step 3: 添加 SkillListingAttachment import**

在文件顶部 import 部分添加：
```typescript
import type { SkillListingAttachment } from "./attachments/types.js";
```

- [ ] **Step 4: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 5: Commit**

```bash
git add src/agent/session.ts
git commit -m "feat(session): add sentSkillNames state management for skill listing deduplication"
```

---

## Task 6: 更新 SkillTool 描述

**Files:**
- Modify: `src/agent/tools/skill.ts:34`

- [ ] **Step 1: 更新 SkillTool description**

将第 34 行的 description：
```typescript
    description: "Execute a skill by name. Skills are specialized prompts that help with specific tasks like brainstorming, code review, or planning.",
```

替换为：
```typescript
    description: `Execute a skill by name.

The first user message includes a skill listing that describes all available skills and when to use them. Use that listing to choose the right skill for the task.

Call this tool with the exact skill name from the listing.`,
```

- [ ] **Step 2: 运行类型检查**

Run: `bun run tsc --noEmit`
Expected: 无新增错误

- [ ] **Step 3: Commit**

```bash
git add src/agent/tools/skill.ts
git commit -m "feat(skill): update SkillTool description to reference skill listing"
```

---

## Task 7: 集成测试

**Files:**
- Modify: `examples/debug-agent-chat.ts`

- [ ] **Step 1: 验证 skill listing 注入行为**

启动 debug-agent-chat.ts：
```bash
bun run examples/debug-agent-chat.ts
```

输入一条普通消息（如 "你好"），观察输出：
- 应该看到 skill listing 被注入到消息中
- 检查 console log 中是否有 skill listing 内容

- [ ] **Step 2: 验证去重行为**

继续输入另一条消息：
- 之前的 skills 不应该重复发送
- 只有新增的 skills（如果有）才应该被发送

- [ ] **Step 3: 验证 SkillTool 描述更新**

输入 "执行 brainstorming skill"：
- 确认 SkillTool 被正确调用
- 确认 skill 内容被注入

---

## 验证命令

所有任务完成后，运行以下验证：

```bash
# 类型检查
bun run tsc --noEmit

# 运行测试（如果存在）
bun run test

# 手动验证
bun run examples/debug-agent-chat.ts
```

---

## 验收标准

- [ ] `src/agent/attachments/types.ts` 包含 `SkillListingAttachment` 类型
- [ ] `src/agent/attachments/skill-listing.ts` 存在且导出 `formatSkillListing` 和 `injectSkillListingAttachments`
- [ ] `src/agent/attachments/normalize.ts` 处理 `skill_listing` case
- [ ] `src/agent/stream-assistant.ts` 在 @mention 之前调用 `injectSkillListingAttachments`
- [ ] `src/agent/session.ts` 包含 `sentSkillNames` 状态和相关方法
- [ ] `src/agent/tools/skill.ts` 描述包含 skill listing 引用
- [ ] 类型检查无错误
