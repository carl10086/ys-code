import React from "react";
import { describe, it, expect } from "bun:test";
import { render } from "ink-testing-library";
import chalk, { Chalk } from "chalk";
import { Ansi } from "./Ansi.js";

// 恢复全局 chalk 为无颜色模式（Ink 内部依赖），避免其他测试的副作用
chalk.level = 0;

// 使用独立的 Chalk 实例生成 ANSI 序列作为输入
const chalk3 = new Chalk({ level: 3 });

describe("Ansi", () => {
  it("renders plain text", () => {
    const { lastFrame } = render(<Ansi>hello</Ansi>);
    expect(lastFrame()).toBe("hello");
  });

  it("renders bold text", () => {
    const { lastFrame } = render(<Ansi>{chalk3.bold("bold")}</Ansi>);
    expect(lastFrame()).toBe("bold");
  });

  it("renders colored text", () => {
    const { lastFrame } = render(<Ansi>{chalk3.red("red")}</Ansi>);
    expect(lastFrame()).toBe("red");
  });

  it("renders dim text", () => {
    const { lastFrame } = render(<Ansi>{chalk3.dim("dim")}</Ansi>);
    expect(lastFrame()).toBe("dim");
  });

  it("renders italic text", () => {
    const { lastFrame } = render(<Ansi>{chalk3.italic("italic")}</Ansi>);
    expect(lastFrame()).toBe("italic");
  });

  it("renders underline text", () => {
    const { lastFrame } = render(<Ansi>{chalk3.underline("underline")}</Ansi>);
    expect(lastFrame()).toBe("underline");
  });

  it("renders strikethrough text", () => {
    const { lastFrame } = render(<Ansi>{chalk3.strikethrough("strike")}</Ansi>);
    expect(lastFrame()).toBe("strike");
  });

  it("renders combined styles", () => {
    const { lastFrame } = render(<Ansi>{chalk3.bold.red("bold red")}</Ansi>);
    expect(lastFrame()).toBe("bold red");
  });

  it("renders empty string", () => {
    const { lastFrame } = render(<Ansi>{""}</Ansi>);
    expect(lastFrame()).toBe("");
  });

  it("applies dimColor prop", () => {
    const { lastFrame } = render(<Ansi dimColor>{chalk3.red("red")}</Ansi>);
    expect(lastFrame()).toBe("red");
  });

  it("renders 256 color", () => {
    const { lastFrame } = render(<Ansi>{chalk3.ansi256(196)("color")}</Ansi>);
    expect(lastFrame()).toBe("color");
  });

  it("renders rgb color", () => {
    const { lastFrame } = render(<Ansi>{chalk3.rgb(255, 0, 0)("rgb")}</Ansi>);
    expect(lastFrame()).toBe("rgb");
  });

  it("renders mixed plain and styled text", () => {
    const input = `hello ${chalk3.bold("world")} end`;
    const { lastFrame } = render(<Ansi>{input}</Ansi>);
    expect(lastFrame()).toBe("hello world end");
  });
});
