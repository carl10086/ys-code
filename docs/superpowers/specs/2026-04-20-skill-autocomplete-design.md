# Skill 自动补全设计方案

## 背景问题

当前 TUI 的斜杠命令（slash command）自动补全不包含 skills。

**问题根因**：
- `src/tui/app.tsx` 第 60 行传给 `PromptInput` 的是 `COMMANDS`（静态导入的内置命令列表）
- `COMMANDS` 只包含内置命令（exit, clear, tools, help, system, skills）
- Skills 是动态加载的，通过 `getCommands(skillsBasePath)` async 获取

**影响**：用户输入 `/` 时，skills 不会出现在自动补全列表中。

## 解决方案

采用与 Claude Code 源码一致的 **启动时加载** 方案：

1. 在 `App` 组件初始化时 async 调用 `getCommands()` 加载完整命令列表
2. 用 `useState` 管理加载状态
3. 加载完成后自动更新 PromptInput 的补全列表

## 改动范围

### 改动文件

| 文件 | 改动内容 |
|------|----------|
| `src/tui/app.tsx` | async 加载 commands，useState 管理 |

### 核心逻辑

```typescript
// src/tui/app.tsx
import { getCommands } from "../commands/index.js";

export function App(): React.ReactElement {
  // 新增：commands 状态
  const [commands, setCommands] = useState<Command[]>([]);

  // 新增：初始化时加载所有命令
  useEffect(() => {
    getCommands(".claude/skills").then(setCommands);
  }, []);

  // ...
  return (
    <PromptInput
      commands={commands}  // 从 COMMANDS 改为 commands state
      // ...
    />
  );
}
```

## 实现步骤

1. `App` 组件添加 `commands` state，初始值为空数组
2. `useEffect` 调用 `getCommands(".claude/skills")` 并更新 state
3. `PromptInput` 的 `commands` prop 从静态 `COMMANDS` 改为动态 `commands`
4. 移除 `COMMANDS` 的静态导入（如不再需要）

## 后续扩展（可选）

当前方案为基础版本，后续可参考 cc 源码添加：

- 使用 `chokidar` 监听 skill 目录变化，热更新命令列表
- 添加 loading 状态优化首次加载体验

## 验证方式

1. 启动应用，输入 `/` 应看到所有内置命令
2. 确认 skills 目录下的 skill 也出现在补全列表中
3. 选中某个 skill 确认可以正常执行
