import { describe, it, expect } from "bun:test";
import React from "react";
import { render } from "ink-testing-library";
import { StatusBar } from "./StatusBar.js";

describe("StatusBar", () => {
  it("renders web port when webUrl is provided", () => {
    const { lastFrame } = render(
      <StatusBar
        status="idle"
        modelName="test-model"
        webUrl="http://127.0.0.1:8080"
      />
    );
    expect(lastFrame()).toContain("[Web: 8080]");
  });

  it("does not render web info when webUrl is not provided", () => {
    const { lastFrame } = render(
      <StatusBar status="idle" modelName="test-model" />
    );
    expect(lastFrame()).not.toContain("Web:");
  });

  it("renders web info alongside cwd and git branch", () => {
    const { lastFrame } = render(
      <StatusBar
        status="idle"
        modelName="test-model"
        cwd="/home/user/project"
        gitBranch="feat/test"
        webUrl="http://127.0.0.1:3000"
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("[Web: 3000]");
    expect(frame).toContain("[/home/user/project]");
    expect(frame).toContain("[feat/test]");
  });
});

describe("StatusBar context progress", () => {
  const baseUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };

  it("computes percentage from input only", () => {
    const { lastFrame } = render(
      <StatusBar
        status="idle"
        modelName="test"
        lastUsage={{ ...baseUsage, input: 10000, totalTokens: 10000 }}
        contextWindow={204800}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("10K/204.8K");
    expect(frame).toContain("5%");
  });

  it("includes input + cacheRead + cacheWrite (cc formula)", () => {
    const { lastFrame } = render(
      <StatusBar
        status="idle"
        modelName="test"
        lastUsage={{
          ...baseUsage,
          input: 5000,
          cacheRead: 8000,
          cacheWrite: 2000,
          output: 1000,
          totalTokens: 16000,
        }}
        contextWindow={204800}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("15K/204.8K");
    expect(frame).not.toContain("16K/");
  });

  it("excludes output_tokens from percentage (regression)", () => {
    const { lastFrame } = render(
      <StatusBar
        status="idle"
        modelName="test"
        lastUsage={{ ...baseUsage, input: 1000, output: 100000, totalTokens: 101000 }}
        contextWindow={204800}
      />
    );
    const frame = lastFrame()!;
    expect(frame).toContain("1K/204.8K");
    expect(frame).not.toContain("101K");
  });

  it("does not render context segment when lastUsage is null", () => {
    const { lastFrame } = render(
      <StatusBar status="idle" modelName="test" lastUsage={null} contextWindow={204800} />
    );
    expect(lastFrame()).not.toContain("[Context:");
  });

  it("clamps percentage to 100 when over the window", () => {
    const { lastFrame } = render(
      <StatusBar
        status="idle"
        modelName="test"
        lastUsage={{ ...baseUsage, input: 300000, totalTokens: 300000 }}
        contextWindow={204800}
      />
    );
    expect(lastFrame()).toContain("100%");
  });
});

describe("extractPortFromUrl", () => {
  it("extracts port from standard URL", () => {
    const { lastFrame } = render(
      <StatusBar status="idle" modelName="test" webUrl="http://127.0.0.1:8080" />
    );
    expect(lastFrame()).toContain("[Web: 8080]");
  });

  it("handles URL without explicit port", () => {
    const { lastFrame } = render(
      <StatusBar status="idle" modelName="test" webUrl="http://127.0.0.1/" />
    );
    expect(lastFrame()).not.toContain("Web:");
  });

  it("handles empty port URL", () => {
    const { lastFrame } = render(
      <StatusBar status="idle" modelName="test" webUrl="http://127.0.0.1/" />
    );
    expect(lastFrame()).not.toContain("Web:");
  });
});
