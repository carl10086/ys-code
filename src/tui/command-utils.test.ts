import { describe, it, expect } from "bun:test";
import { dispatchCommandResult } from "./command-utils.js";

describe("dispatchCommandResult", () => {
  it("当 result.handled 为 false 时返回 false 且不做任何操作", () => {
    let promptCalled = false;
    let userMessage = "";
    const session = { prompt: () => { promptCalled = true; } } as any;
    const appendUserMessage = (text: string) => { userMessage = text; };
    const appendSystemMessage = () => {};

    const result = { handled: false };
    const handled = dispatchCommandResult(
      result,
      "/spec 1",
      session,
      appendUserMessage,
      appendSystemMessage,
    );

    expect(handled).toBe(false);
    expect(promptCalled).toBe(false);
    expect(userMessage).toBe("");
  });

  it("当 handled 为 true 且无 metaMessages 时发送普通 prompt", () => {
    let promptArg: unknown;
    let userMessage = "";
    const session = { prompt: (arg: unknown) => { promptArg = arg; } } as any;
    const appendUserMessage = (text: string) => { userMessage = text; };
    const appendSystemMessage = () => {};

    const result = { handled: true };
    const handled = dispatchCommandResult(
      result,
      "/spec 1",
      session,
      appendUserMessage,
      appendSystemMessage,
    );

    expect(handled).toBe(true);
    expect(userMessage).toBe("/spec 1");
    expect(promptArg).toBe("/spec 1");
  });

  it("当 handled 为 true 且有 metaMessages 时发送 messages 数组", () => {
    let promptArg: unknown;
    let userMessage = "";
    const session = { prompt: (arg: unknown) => { promptArg = arg; } } as any;
    const appendUserMessage = (text: string) => { userMessage = text; };
    const appendSystemMessage = () => {};

    const result = { handled: true, metaMessages: ["meta content"] };
    const handled = dispatchCommandResult(
      result,
      "/spec 1",
      session,
      appendUserMessage,
      appendSystemMessage,
    );

    expect(handled).toBe(true);
    expect(userMessage).toBe("/spec 1");
    expect(Array.isArray(promptArg)).toBe(true);
    const messages = promptArg as Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content[0].text).toBe("/spec 1");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content[0].text).toBe("meta content");
  });

  it("当 result.textResult 存在时调用 appendSystemMessage", () => {
    let systemMessage = "";
    const session = { prompt: () => {} } as any;
    const appendUserMessage = () => {};
    const appendSystemMessage = (text: string) => { systemMessage = text; };

    const result = { handled: true, textResult: "Done" };
    dispatchCommandResult(
      result,
      "/spec 1",
      session,
      appendUserMessage,
      appendSystemMessage,
    );

    expect(systemMessage).toBe("Done");
  });

  it("当 result.model 存在时传递给 session.prompt", () => {
    let promptArgs: unknown[] = [];
    let userMessage = "";
    const session = { prompt: (...args: unknown[]) => { promptArgs = args; } } as any;
    const appendUserMessage = (text: string) => { userMessage = text; };
    const appendSystemMessage = () => {};

    const result = { handled: true, metaMessages: ["meta"], model: "MiniMax-M2.7" };
    dispatchCommandResult(
      result,
      "/spec 1",
      session,
      appendUserMessage,
      appendSystemMessage,
    );

    expect(userMessage).toBe("/spec 1");
    expect(promptArgs.length).toBe(2);
    expect((promptArgs[1] as any).model).toBe("MiniMax-M2.7");
  });
});
