import { describe, it, expect } from "bun:test";
import { render } from "ink-testing-library";
import { PromptInput } from "./PromptInput.js";

describe("PromptInput", () => {
  it("renders input prompt", () => {
    const { lastFrame } = render(
      <PromptInput onSubmit={() => {}} onCommand={() => true} commands={[]} />
    );
    expect(lastFrame()).toContain(">");
  });

  it("does not call onSubmit/onCommand when disabled", async () => {
    let called = false;
    const { stdin } = render(
      <PromptInput
        disabled
        onSubmit={() => { called = true; }}
        onCommand={() => true}
        commands={[]}
      />
    );

    stdin.write("test");
    stdin.write("\r");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(called).toBe(false);
  });
});
