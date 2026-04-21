# StatusBar 增强实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** StatusBar 显示 cwd（缩写格式）、git 分支名称和 context 使用率，移除 cost

**架构：** 实现 GitBranchProvider 类提供 git 分支订阅能力，StatusBar 通过 props 接收并显示

**技术栈：** TypeScript, React (Ink), fs.watch

---

## 涉及的文件

- `src/utils/git-branch-provider.ts` - 新增：GitBranchProvider 类
- `src/agent/context/user-context.ts` - 修改：增加 gitBranch 字段
- `src/tui/components/StatusBar.tsx` - 修改：新增 cwd/gitBranch props，移除 cost
- `src/tui/app.tsx` - 修改：透传 cwd、git 信息给 StatusBar

---

## Task 1: 实现 GitBranchProvider 类

**文件:**
- Create: `src/utils/git-branch-provider.ts`

参考 `pi-mono/packages/coding-agent/src/core/footer-data-provider.ts` 的 FooterDataProvider 类，实现简化版本。

- [ ] **Step 1: 创建 GitBranchProvider 类**

```typescript
// src/utils/git-branch-provider.ts
import { existsSync, type FSWatcher, readFileSync, watch, unwatchFile } from "fs";
import { dirname, join } from "path";

const WATCH_DEBOUNCE_MS = 500;

export class GitBranchProvider {
  private cwd: string;
  private gitHeadPath: string | null = null;
  private cachedBranch: string | null | undefined = undefined;
  private watcher: FSWatcher | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private branchChangeCallbacks = new Set<() => void>();
  private disposed = false;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.gitHeadPath = this.findGitHeadPath();
    this.setupWatcher();
  }

  /** 获取当前分支（缓存 + 懒加载） */
  getBranch(): string | null {
    if (this.cachedBranch === undefined) {
      this.cachedBranch = this.resolveBranchSync();
    }
    return this.cachedBranch;
  }

  /** 订阅分支变化。返回取消订阅函数。 */
  onBranchChange(callback: () => void): () => void {
    this.branchChangeCallbacks.add(callback);
    return () => this.branchChangeCallbacks.delete(callback);
  }

  /** 释放资源 */
  dispose(): void {
    this.disposed = true;
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.branchChangeCallbacks.clear();
  }

  /** 查找 .git/HEAD 路径 */
  private findGitHeadPath(): string | null {
    try {
      const headPath = join(this.cwd, ".git", "HEAD");
      if (existsSync(headPath)) {
        return headPath;
      }
    } catch {
      // ignore
    }
    return null;
  }

  /** 设置文件系统监听 */
  private setupWatcher(): void {
    if (!this.gitHeadPath) return;
    try {
      this.watcher = watch(dirname(this.gitHeadPath), (_eventType, filename) => {
        if (!filename || filename.toString() === "HEAD") {
          this.scheduleRefresh();
        }
      });
    } catch {
      // Silently fail if we can't watch
    }
  }

  /** 调度刷新（500ms debounce） */
  private scheduleRefresh(): void {
    if (this.disposed || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshAsync();
    }, WATCH_DEBOUNCE_MS);
  }

  /** 异步刷新分支 */
  private async refreshAsync(): Promise<void> {
    if (this.disposed) return;
    const nextBranch = this.resolveBranchSync();
    if (this.cachedBranch !== undefined && this.cachedBranch !== nextBranch) {
      this.cachedBranch = nextBranch;
      this.notifyBranchChange();
      return;
    }
    this.cachedBranch = nextBranch;
  }

  /** 通知分支变化 */
  private notifyBranchChange(): void {
    for (const cb of this.branchChangeCallbacks) {
      cb();
    }
  }

  /** 同步解析分支（读取 .git/HEAD） */
  private resolveBranchSync(): string | null {
    if (!this.gitHeadPath) return null;
    try {
      const content = readFileSync(this.gitHeadPath, "utf8").trim();
      if (content.startsWith("ref: refs/heads/")) {
        return content.slice(16);
      }
      return "detached";
    } catch {
      return null;
    }
  }
}

export const gitBranchProvider = new GitBranchProvider();
```

- [ ] **Step 2: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 3: 提交**

```bash
git add src/utils/git-branch-provider.ts
git commit -m "feat: add GitBranchProvider for git branch watching"
```

---

## Task 2: UserContext 增加 git 信息

**文件:**
- Modify: `src/agent/context/user-context.ts`

- [ ] **Step 1: 修改 UserContext 接口**

在 `UserContext` 接口中新增 `gitBranch` 字段：

```typescript
/** 用户上下文 */
export interface UserContext {
  /** CLAUDE.md 聚合内容 */
  claudeMd?: string;
  /** 当前日期 */
  currentDate?: string;
  /** Git 分支名称 */
  gitBranch?: string;
}
```

- [ ] **Step 2: 修改 _getUserContext 函数**

在 `_getUserContext` 函数中，获取 git 分支：

```typescript
// 在 return context 之前添加
const { gitBranchProvider } = await import("../../utils/git-branch-provider.js");
context.gitBranch = gitBranchProvider.getBranch() ?? undefined;
```

- [ ] **Step 3: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add src/agent/context/user-context.ts
git commit -m "feat(UserContext): add gitBranch field"
```

---

## Task 3: StatusBar 组件改造

**文件:**
- Modify: `src/tui/components/StatusBar.tsx`

- [ ] **Step 1: 修改 Props 接口**

```typescript
export interface StatusBarProps {
  /** 当前状态 */
  status: "idle" | "streaming" | "tool_executing";
  /** 模型名称 */
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

移除 `cost?: number`。

- [ ] **Step 2: 移除 formatCost 函数**

删除 `formatCost` 函数。

- [ ] **Step 3: 添加 cwd 格式化函数**

```typescript
/** 格式化 cwd（缩写格式）：/Users/carl/project → ~/project */
function formatCwd(cwd: string): string {
  const home = process.env.HOME ?? "";
  if (home && cwd.startsWith(home)) {
    return "~" + cwd.slice(home.length);
  }
  return cwd;
}
```

- [ ] **Step 4: 修改组件参数解构和渲染逻辑**

更新函数签名：
```typescript
export function StatusBar({ status, modelName, cwd, gitBranch, totalTokens, contextWindow }: StatusBarProps): React.ReactElement {
```

更新显示逻辑，移除 cost 显示，添加 cwd 和 gitBranch：

```typescript
<Box height={1} flexDirection="row" justifyContent="space-between">
  <Text color={statusColor}>{statusText}</Text>
  <Box>
    <Text color="gray">{modelName}</Text>
    {cwd && (
      <Text color="gray"> [{formatCwd(cwd)}]</Text>
    )}
    {gitBranch && (
      <Text color="gray"> [{gitBranch}]</Text>
    )}
    {percentage !== null && (
      <Text color="gray">
        {" "}[Context: {formatTokens(totalTokens!)}/{formatTokens(contextWindow!)} {renderProgressBar(percentage)} {percentage}%]
      </Text>
    )}
  </Box>
</Box>
```

- [ ] **Step 5: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/tui/components/StatusBar.tsx
git commit -m "feat(StatusBar): add cwd and gitBranch display, remove cost"
```

---

## Task 4: App 组件联动

**文件:**
- Modify: `src/tui/app.tsx`

- [ ] **Step 1: 导入 gitBranchProvider**

在文件顶部添加导入：
```typescript
import { gitBranchProvider } from "../utils/git-branch-provider.js";
```

- [ ] **Step 2: 添加 git 分支 state 和 useEffect**

在 App 组件中添加 state 和订阅：

```typescript
const [gitBranch, setGitBranch] = useState<string | null>(gitBranchProvider.getBranch());

useEffect(() => {
  const unsubscribe = gitBranchProvider.onBranchChange(() => {
    setGitBranch(gitBranchProvider.getBranch());
  });
  return unsubscribe;
}, []);
```

- [ ] **Step 3: 从 useAgent 解构中移除 cost**

```typescript
const { session, messages, shouldScrollToBottom, markScrolled, appendUserMessage, appendSystemMessage, resetSession, totalTokens } = useAgent({
```

- [ ] **Step 4: 透传给 StatusBar**

更新 StatusBar 调用：

```typescript
<StatusBar
  status={status}
  modelName={session.model.name}
  cwd={process.cwd()}
  gitBranch={gitBranch}
  totalTokens={totalTokens}
  contextWindow={session.model.contextWindow}
/>
```

注意：session.cwd 是私有属性，使用 `process.cwd()` 获取当前工作目录。

- [ ] **Step 5: 运行类型检查**

Run: `npx tsc --noEmit`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add src/tui/app.tsx
git commit -m "feat(App): wire cwd and gitBranch to StatusBar"
```

---

## 验收标准检查清单

- [ ] GitBranchProvider 正确获取和监听 git 分支
- [ ] StatusBar 正确显示 cwd（缩写格式）
- [ ] StatusBar 正确显示 git 分支名称
- [ ] StatusBar 正确显示 context 使用率和进度条
- [ ] Cost 不再显示
- [ ] git checkout 后分支信息自动刷新
