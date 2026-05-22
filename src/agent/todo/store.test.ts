import { describe, it, expect, beforeEach } from "bun:test";
import { TodoStore, type TodoStoreEvent } from "./store.js";
import type { TodoItem } from "./types.js";

const item = (content: string, status: TodoItem["status"], activeForm?: string): TodoItem => ({
  content,
  status,
  activeForm: activeForm ?? content,
});

describe("TodoStore", () => {
  let store: TodoStore;

  beforeEach(() => {
    store = new TodoStore();
  });

  it("初始为空列表", () => {
    expect(store.get()).toEqual([]);
  });

  it("set 全量覆盖旧列表", () => {
    store.set([item("A", "pending")]);
    store.set([item("B", "in_progress"), item("C", "pending")]);
    expect(store.get()).toEqual([
      item("B", "in_progress"),
      item("C", "pending"),
    ]);
  });

  it("全 completed 时内部 todos 清空", () => {
    store.set([
      item("A", "completed"),
      item("B", "completed"),
    ]);
    expect(store.get()).toEqual([]);
  });

  it("set 的返回值 newTodos 是用户原始提交值（即使内部已清空）", () => {
    const submitted = [item("A", "completed"), item("B", "completed")];
    const result = store.set(submitted);
    expect(result.newTodos).toEqual(submitted);
    expect(store.get()).toEqual([]); // 内部已清空，但返回的是原值
  });

  it("get 返回拷贝，外部 mutate 不影响内部", () => {
    store.set([item("A", "pending")]);
    const view = store.get();
    view[0]!.content = "MUTATED";
    expect(store.get()[0]!.content).toBe("A");
  });

  it("subscribe 在 set 后触发，事件 newTodos 等于内部 todos", () => {
    const events: TodoStoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.set([item("A", "pending")]);
    expect(events).toHaveLength(1);
    expect(events[0]!.newTodos).toEqual([item("A", "pending")]);
    expect(events[0]!.newTodos).toEqual(store.get());
  });

  it("subscribe 在全 completed 自动清空场景下，事件 newTodos 是清空后的空数组", () => {
    const events: TodoStoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.set([item("A", "completed")]);
    expect(events[0]!.newTodos).toEqual([]);
  });

  it("subscribe 返回的 unsubscribe 函数能取消监听", () => {
    let count = 0;
    const unsubscribe = store.subscribe(() => {
      count += 1;
    });
    store.set([item("A", "pending")]);
    unsubscribe();
    store.set([item("B", "pending")]);
    expect(count).toBe(1);
  });

  it("reset 等价于 set([])", () => {
    store.set([item("A", "in_progress")]);
    const events: TodoStoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.reset();
    expect(store.get()).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]!.newTodos).toEqual([]);
  });

  it("事件 oldTodos 反映 set 前的状态", () => {
    store.set([item("A", "pending")]);
    const events: TodoStoreEvent[] = [];
    store.subscribe((e) => events.push(e));
    store.set([item("B", "pending")]);
    expect(events[0]!.oldTodos).toEqual([item("A", "pending")]);
  });
});
