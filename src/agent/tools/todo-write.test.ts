import { describe, it, expect, beforeEach } from "bun:test";
import { createTodoWriteTool, TODO_WRITE_DESCRIPTION, TODO_WRITE_FIXED_RESULT_TEXT } from "./todo-write.js";
import { TodoStore } from "../todo/store.js";
import type { TodoItem } from "../todo/types.js";

const item = (content: string, status: TodoItem["status"], activeForm?: string): TodoItem => ({
  content,
  status,
  activeForm: activeForm ?? content,
});

describe("TodoWriteTool", () => {
  let store: TodoStore;
  let tool: ReturnType<typeof createTodoWriteTool>;

  beforeEach(() => {
    store = new TodoStore();
    tool = createTodoWriteTool(store);
  });

  it("工具元数据符合预期", () => {
    expect(tool.name).toBe("TodoWrite");
    expect(tool.label).toBe("TodoWrite");
    expect(tool.isReadOnly).toBe(false);
    expect(tool.isConcurrencySafe).toBe(false);
    expect(tool.isDestructive).toBe(false);
  });

  it("description 是非空字符串", () => {
    expect(typeof tool.description).toBe("string");
    expect((tool.description as string).length).toBeGreaterThan(10);
  });

  it("description 不含未解析的 ${} 插值占位（防止变量遗漏）", () => {
    expect(TODO_WRITE_DESCRIPTION).not.toContain("${");
  });

  it("prompt 包含完整的 TodoWrite 指南", () => {
    expect(tool.prompt).toContain("Use this tool to create and manage a structured task list");
    expect(tool.prompt).toContain("When to Use This Tool");
    expect(tool.prompt).toContain("Task States and Management");
  });

  it("description 是简短摘要（不超过 200 字符）", () => {
    expect(typeof tool.description).toBe("string");
    expect((tool.description as string).length).toBeLessThanOrEqual(200);
    expect((tool.description as string)).toContain("TodoWrite");
  });

  it("execute 将 todos 写入 store", async () => {
    const todos = [item("A", "pending"), item("B", "in_progress")];
    const output = await tool.execute(
      "call-1",
      { todos },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.newTodos).toEqual(todos);
    expect(output.oldTodos).toEqual([]);
    expect(store.get()).toEqual(todos);
  });

  it("execute 返回的 oldTodos 反映 set 前的状态", async () => {
    store.set([item("A", "pending")]);
    const output = await tool.execute(
      "call-2",
      { todos: [item("B", "in_progress")] },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.oldTodos).toEqual([item("A", "pending")]);
    expect(output.newTodos).toEqual([item("B", "in_progress")]);
  });

  it("execute 在全 completed 时，store 内部清空但返回值保留原始提交", async () => {
    const submitted = [item("A", "completed"), item("B", "completed")];
    const output = await tool.execute(
      "call-3",
      { todos: submitted },
      { abortSignal: new AbortController().signal } as any,
    );

    expect(output.newTodos).toEqual(submitted);
    expect(store.get()).toEqual([]);
  });

  it("formatResult 返回 cc 的固定文本（一字不改）", () => {
    const expected =
      "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable";

    expect(TODO_WRITE_FIXED_RESULT_TEXT).toBe(expected);

    const result = tool.formatResult!(
      { oldTodos: [], newTodos: [item("A", "pending")] },
      "call-1",
    );
    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual([{ type: "text", text: expected }]);
  });

  it("renderResult 返回 todo_list 渲染数据", () => {
    const output = {
      oldTodos: [item("A", "pending")],
      newTodos: [item("B", "in_progress")],
    };
    const rendered = tool.renderResult!(output, "call-1");
    expect(rendered).toEqual({
      type: "todo_list",
      oldTodos: output.oldTodos,
      newTodos: output.newTodos,
    });
  });
});
