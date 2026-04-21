# StatusBar 增强设计：cwd、git 信息和 context 使用率

## 背景

当前 StatusBar 仅显示 status 和 modelName。需要增强为显示：
1. **cwd** - 当前工作目录（缩写格式）
2. **git 信息** - 分支名称和状态
3. **context 使用率** - token 总量和百分比（移除 cost）

参考 cc 的 GitFileWatcher 实现，实现基于文件系统监听的 git 信息刷新。

## 目标

StatusBar 显示格式：
```
[Status] [Model] [~/project] [git:main●] [Context: 45K/200K ████░░░░░░ 22%]
```

- `~/project` - cwd 缩写格式
- `git:main●` - 分支名 + 状态标记（●=clean, ○=dirty）
- `Context: 45K/200K ████░░░░░░ 22%` - context 使用情况

## 实现方案

### 1. GitFileWatcher 实现

参考 `cc/src/utils/git/gitFilesystem.ts` 的 `GitFileWatcher` 类，实现简化版本。

**文件：** `src/utils/git/git-file-watcher.ts`

**功能：**
- 监听 `.git/HEAD` 文件变化（分支切换、detached HEAD）
- 缓存分支名称，变化时自动失效
- 提供 `getBranch()` 方法获取当前分支

**核心逻辑：**
```typescript
class GitFileWatcher {
  private cache = new Map<string, { value: string; dirty: boolean }>()

  // 监听 .git/HEAD 变化
  private watchGitHead(callback: () => void): void

  // 获取分支（缓存 + 懒加载）
  async getBranch(): Promise<string>

  // 标记缓存为 dirty
  private invalidate(): void
}

export const gitFileWatcher = new GitFileWatcher()
```

**与 cc 的差异：**
- 简化：不处理 worktree、submodule 等复杂场景
- 只监听 `.git/HEAD`，不监听 refs 文件（简化实现）
- 使用 `fs.watch` 而不是 `fs.watchFile`（Node.js 16+ 推荐）

### 2. UserContext 增加 git 信息

**文件：** `src/agent/context/user-context.ts`

**改动：**
- `UserContext` 接口新增 `gitBranch?: string` 字段
- `getUserContext()` 调用 `gitFileWatcher.getBranch()` 获取分支
- 缓存 key 包含 `gitBranch`（但 git 信息本身通过 watcher 刷新）

### 3. StatusBar 组件改造

**文件：** `src/tui/components/StatusBar.tsx`

**Props 变更：**
```typescript
export interface StatusBarProps {
  status: "idle" | "streaming" | "tool_executing";
  modelName: string;
  /** 当前工作目录（缩写格式） */
  cwd?: string;
  /** Git 分支名称 */
  gitBranch?: string;
  /** Git 是否有未提交变更 */
  gitDirty?: boolean;
  /** 累计 token 总数 */
  totalTokens?: number;
  /** 模型 context window 大小 */
  contextWindow?: number;
}
```

**移除：**
- `cost?: number` - 不再显示

**显示格式：**
```typescript
// cwd 格式化：/Users/carl/project/ys-code → ~/ys-code
function formatCwd(cwd: string): string {
  const home = process.env.HOME ?? ''
  if (cwd.startsWith(home)) {
    return '~' + cwd.slice(home.length)
  }
  return cwd
}

// StatusBar 右侧显示顺序：
// [cwd] [git:branch●] [Context: 45K/200K ████░░░░░░ 22%]
```

### 4. App 组件联动

**文件：** `src/tui/app.tsx`

**改动：**
- 从 `session` 获取 `cwd`（已在 App 组件中可用）
- 通过 `gitFileWatcher.getBranch()` 和 `gitFileWatcher.isDirty()` 获取 git 信息
- 透传给 StatusBar

**注意：** git 信息需要通过 `useEffect` 监听变化并更新 state。

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/utils/git/git-file-watcher.ts` | 新增：GitFileWatcher 类 |
| `src/agent/context/user-context.ts` | 修改：增加 gitBranch 字段 |
| `src/tui/components/StatusBar.tsx` | 修改：新增 props，移除 cost |
| `src/tui/app.tsx` | 修改：透传 cwd、git 信息 |

## 验收标准

1. StatusBar 正确显示 cwd（缩写格式）
2. StatusBar 正确显示 git 分支名称
3. 执行 `git checkout` 后，git 分支信息自动刷新
4. Context 使用率和进度条正确显示
5. Cost 不再显示
