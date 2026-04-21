# StatusBar 增强设计：cwd、git 信息和 context 使用率

## 背景

当前 StatusBar 仅显示 status 和 modelName。需要增强为显示：
1. **cwd** - 当前工作目录（缩写格式）
2. **git 信息** - 分支名称
3. **context 使用率** - token 总量和百分比

参考 `pi-mono` 的 `FooterDataProvider` 实现，实现基于文件系统监听的 git 信息刷新。

## 目标

StatusBar 显示格式（两行布局）：
```
[Status] [Model]
[cwd] [gitBranch] [Context: 45K/200K ████░░░░░░ 22%]
```

- 第一行：状态 + 模型名称
- 第二行：cwd（缩写） + git 分支 + context 使用情况

## 实现方案

### 1. GitBranchProvider 实现

参考 `pi-mono/packages/coding-agent/src/core/footer-data-provider.ts` 的 `FooterDataProvider` 类，实现简化版本。

**文件：** `src/utils/git-branch-provider.ts`

**功能：**
- 查找 `.git/HEAD` 路径
- 监听 `.git/HEAD` 所在目录（`fs.watch`）
- 500ms debounce 刷新机制
- `onBranchChange(callback)` 订阅机制

**核心逻辑：**
```typescript
class GitBranchProvider {
  private cachedBranch: string | null | undefined = undefined
  private watcher: FSWatcher | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private branchChangeCallbacks = new Set<() => void>()

  constructor(cwd: string = process.cwd())

  // 获取分支（缓存 + 懒加载）
  getBranch(): string | null

  // 订阅分支变化
  onBranchChange(callback: () => void): () => void

  // 内部：设置监听器
  private setupWatcher(): void

  // 内部：调度刷新
  private scheduleRefresh(): void

  // 内部：刷新分支
  private async refreshAsync(): Promise<void>

  // 内部：解析分支（同步读取 .git/HEAD）
  private resolveBranchSync(): string | null

  dispose(): void
}

export const gitBranchProvider = new GitBranchProvider()
```

**简化说明：**
- 不支持 worktree（直接读取 `.git/HEAD`，不解析 worktree 指针）
- 不支持 reftable（只监听 HEAD 目录）
- 不支持 dirty 状态检测（只显示分支名）

### 2. UserContext 增加 git 信息

**文件：** `src/agent/context/user-context.ts`

**改动：**
- `UserContext` 接口新增 `gitBranch?: string` 字段
- `getUserContext()` 调用 `gitBranchProvider.getBranch()` 获取分支
- 每次 `getUserContext()` 调用时重新获取（依赖 watcher 刷新缓存）

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
  gitBranch?: string | null;
  /** 累计 token 总数 */
  totalTokens?: number;
  /** 模型 context window 大小 */
  contextWindow?: number;
}
```

**显示格式（两行布局）：**
```
第一行：[Status] [Model]
第二行：[cwd] [gitBranch] [Context: 45K/200K ████░░░░░░ 22%]
```

### 4. App 组件联动

**文件：** `src/tui/app.tsx`

**改动：**
- 通过 `gitBranchProvider.getBranch()` 获取 git 分支
- 通过 `gitBranchProvider.onBranchChange()` 订阅分支变化
- 透传给 StatusBar

**注意：** 使用 `useEffect` 订阅分支变化，变化时更新 state 触发重渲染。

## 改动范围

| 文件 | 改动 |
|------|------|
| `src/utils/git-branch-provider.ts` | 新增：GitBranchProvider 类（参考 pi-mono FooterDataProvider） |
| `src/agent/context/user-context.ts` | 修改：增加 gitBranch 字段 |
| `src/tui/components/StatusBar.tsx` | 修改：新增 props，移除 cost |
| `src/tui/app.tsx` | 修改：透传 cwd、git 信息 |

## 验收标准

1. StatusBar 两行布局：上行 status + model，下行 cwd + git + context
2. StatusBar 正确显示 cwd（缩写格式）
3. StatusBar 正确显示 git 分支名称
4. 执行 `git checkout` 后，git 分支信息自动刷新（通过 fs.watch 监听）
5. Context 使用率和进度条正确显示
6. Token 总数正确显示
