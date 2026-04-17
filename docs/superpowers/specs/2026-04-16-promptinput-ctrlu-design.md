# PromptInput Ctrl+U 删除当前行设计文档

**目标：** 在 TUI 的 `PromptInput` 组件中支持 `Ctrl+U` 快捷键，用于快速删除当前光标所在行的全部内容。

**行为定义：**
- 触发条件：`key.ctrl && input === "u"`
- 效果：将 `lines[cursorLine]` 清空为 `""`，并将 `cursorCol` 重置为 `0`
- 范围：仅删除当前行，不影响其他行
- 边界：如果当前行本来就是空的，则无任何可见变化
- 提交保护：空行输入在 `Enter` 提交时会被 `trim()` 过滤，不会触发误提交

**文件变更：**
- `src/tui/components/PromptInput.tsx`：在 `useInput` 回调中添加 `Ctrl+U` 分支
