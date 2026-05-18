import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { TodoPanel } from "./TodoPanel.js";
import type { TodoItem } from "../../agent/todo/types.js";

const item = (content: string, status: TodoItem["status"], activeForm?: string): TodoItem => ({
  content,
  status,
  activeForm: activeForm ?? content,
});

describe("TodoPanel", () => {
  it("空列表时渲染为 null（不占行）", () => {
    const { lastFrame } = render(<TodoPanel todos={[]} />);
    expect(lastFrame()).toBe("");
  });

  it("渲染 pending 项使用 ☐ + content", () => {
    const { lastFrame } = render(<TodoPanel todos={[item("Run tests", "pending")]} />);
    const frame = lastFrame()!;
    expect(frame).toContain("☐");
    expect(frame).toContain("Run tests");
  });

  it("渲染 in_progress 项使用 ◐ + activeForm", () => {
    const { lastFrame } = render(
      <TodoPanel todos={[item("Run tests", "in_progress", "Running tests")]} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("◐");
    expect(frame).toContain("Running tests");
    expect(frame).not.toContain("Run tests"); // 仅显示 activeForm
  });

  it("渲染 completed 项使用 ☑ + content", () => {
    const { lastFrame } = render(<TodoPanel todos={[item("Run tests", "completed")]} />);
    const frame = lastFrame()!;
    expect(frame).toContain("☑");
    expect(frame).toContain("Run tests");
  });

  it("title 显示 completed/total 进度", () => {
    const { lastFrame } = render(
      <TodoPanel
        todos={[
          item("A", "completed"),
          item("B", "in_progress", "Doing B"),
          item("C", "pending"),
        ]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toMatch(/Tasks.*1\/3/);
  });

  it("混合状态全部渲染", () => {
    const { lastFrame } = render(
      <TodoPanel
        todos={[
          item("A", "completed"),
          item("B", "in_progress", "Doing B"),
          item("C", "pending"),
        ]}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain("☑");
    expect(frame).toContain("◐");
    expect(frame).toContain("☐");
    expect(frame).toContain("A");
    expect(frame).toContain("Doing B");
    expect(frame).toContain("C");
  });
});
