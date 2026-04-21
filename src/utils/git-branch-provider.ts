import { existsSync, type FSWatcher, readFileSync, watch } from "fs";
import { dirname, join } from "path";

/**
 * 简化版 Git 分支提供者，仅监听 .git/HEAD 文件夹变化
 * - 不支持 worktree
 * - 不支持 reftable
 * - 不支持 dirty 状态检测
 */
export class GitBranchProvider {
	private cwd: string;
	private gitHeadPath: string | null = null;
	private cachedBranch: string | null | undefined = undefined;
	private watcher: FSWatcher | null = null;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;
	private branchChangeCallbacks = new Set<() => void>();
	private disposed = false;

	private static readonly WATCH_DEBOUNCE_MS = 500;

	constructor(cwd: string = process.cwd()) {
		this.cwd = cwd;
		this.gitHeadPath = this.findGitHeadPath();
		this.setupWatcher();
	}

	/**
	 * 获取当前分支名
	 * @returns 分支名，未在 git 仓库中返回 null
	 */
	getBranch(): string | null {
		if (this.cachedBranch === undefined) {
			this.cachedBranch = this.resolveBranchSync();
		}
		return this.cachedBranch;
	}

	/**
	 * 订阅分支变化通知
	 * @param callback 分支变化时的回调函数
	 * @returns 取消订阅函数
	 */
	onBranchChange(callback: () => void): () => void {
		this.branchChangeCallbacks.add(callback);
		return () => this.branchChangeCallbacks.delete(callback);
	}

	/**
	 * 释放资源
	 */
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

	/**
	 * 查找 .git/HEAD 文件路径
	 */
	private findGitHeadPath(): string | null {
		let dir = this.cwd;
		while (true) {
			const gitPath = join(dir, ".git");
			if (existsSync(gitPath)) {
				const headPath = join(gitPath, "HEAD");
				if (existsSync(headPath)) {
					return headPath;
				}
			}
			const parent = dirname(dir);
			if (parent === dir) return null;
			dir = parent;
		}
	}

	/**
	 * 设置文件监听器
	 * 监听 .git 目录（而不是 .git/HEAD 文件），因为 git 使用原子写入
	 */
	private setupWatcher(): void {
		if (!this.gitHeadPath) return;

		const gitDir = dirname(this.gitHeadPath);
		try {
			this.watcher = watch(gitDir, (_eventType, filename) => {
				if (!filename || filename.toString() === "HEAD") {
					this.scheduleRefresh();
				}
			});
		} catch {
			// 忽略监听失败
		}
	}

	/**
	 * 调度刷新（500ms debounce）
	 */
	private scheduleRefresh(): void {
		if (this.disposed || this.refreshTimer) return;
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			void this.refreshAsync();
		}, GitBranchProvider.WATCH_DEBOUNCE_MS);
	}

	/**
	 * 异步刷新分支信息
	 */
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

	/**
	 * 通知分支变化
	 */
	private notifyBranchChange(): void {
		for (const cb of this.branchChangeCallbacks) {
			cb();
		}
	}

	/**
	 * 同步解析当前分支
	 */
	private resolveBranchSync(): string | null {
		try {
			if (!this.gitHeadPath) return null;
			const content = readFileSync(this.gitHeadPath, "utf8").trim();
			if (content.startsWith("ref: refs/heads/")) {
				return content.slice(16);
			}
			return null; // detached HEAD 状态返回 null
		} catch {
			return null;
		}
	}
}

/** 全局单例 */
export const gitBranchProvider = new GitBranchProvider();
