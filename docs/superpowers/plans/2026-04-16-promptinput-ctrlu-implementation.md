# PromptInput Ctrl+U 删除当前行实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `PromptInput` 组件中添加 `Ctrl+U` 快捷键支持，快速清空当前输入行。

**Architecture:** 在 `useInput` 回调中检测 `key.ctrl && input === "u"`，将当前行内容清空并重置光标到行首。

**Tech Stack:** TypeScript, React, Ink

---

### Task 1: 在 PromptInput 中实现 Ctrl+U 删除当前行

**Files:**
- Modify: `src/tui/components/PromptInput.tsx`
- Test: `src/tui/hooks/__tests__/useAgent.test.ts`（已有基础测试，运行全部 TUI 相关测试验证无回归）

- [ ] **Step 1: 实现 Ctrl+U 逻辑**

在 `useInput` 回调中，在 `key.backspace || key.delete` 分支之后添加：

```typescript
if (key.ctrl && input === "u") {
  setLines((prev) => prev.map((l, i) => (i === cursorLine ? "" : l)));
  setCursorCol(0);
  return;
}
```

- [ ] **Step 2: 运行类型检查和测试**

Run: `bun run typecheck && bun test src/tui/`
Expected: 全部通过

- [ ] **Step 3: Commit**

```bash
git add src/tui/components/PromptInput.tsx
git commit -m "feat(tui): add Ctrl+U to clear current input line"
```
