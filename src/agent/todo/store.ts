import type { TodoList } from "./types.js";

export interface TodoStoreEvent {
  type: "update";
  oldTodos: TodoList;
  newTodos: TodoList;
}

export type TodoStoreListener = (event: TodoStoreEvent) => void;

export interface TodoStoreSetResult {
  oldTodos: TodoList;
  newTodos: TodoList;
}

/**
 * 进程内 todo 列表存储。
 *
 * 写语义对齐 Claude Code 的 TodoWrite：全量覆盖、全 completed 自动清空。
 * - `set()` 返回的 `newTodos` 是调用者提交的原始值（包含可能被自动清空的 completed 项）
 * - 订阅事件中的 `newTodos` 是清空后的内部状态（与 `get()` 返回值一致）
 */
export class TodoStore {
  private todos: TodoList = [];
  private listeners = new Set<TodoStoreListener>();

  get(): TodoList {
    return this.todos.map((t) => ({ ...t }));
  }

  set(next: TodoList): TodoStoreSetResult {
    const oldTodos = this.todos;
    const allDone = next.length > 0 && next.every((t) => t.status === "completed");
    this.todos = allDone ? [] : next.map((t) => ({ ...t }));
    const event: TodoStoreEvent = {
      type: "update",
      oldTodos,
      newTodos: this.todos,
    };
    for (const fn of this.listeners) {
      fn(event);
    }
    return { oldTodos, newTodos: next };
  }

  reset(): void {
    this.set([]);
  }

  subscribe(fn: TodoStoreListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
