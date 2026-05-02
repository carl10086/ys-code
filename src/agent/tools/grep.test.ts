import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createGrepTool } from "./grep.js";

function mockContext(): any {
  return {
    abortSignal: new AbortController().signal,
    messages: [],
    tools: [],
    fileStateCache: {},
  };
}

async function withFixture<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ys-grep-tool-"));
  try {
    await writeFile(join(dir, "alpha.ts"), "export const target = 1;\n", "utf-8");
    await writeFile(join(dir, "beta.md"), "target in markdown\n", "utf-8");
    await writeFile(join(dir, "gamma.ts"), "nothing here\n", "utf-8");
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await writeFile(join(dir, "node_modules", "ignored.ts"), "target should not appear\n", "utf-8");
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "dist", "ignored.ts"), "target should not appear\n", "utf-8");
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "ignored"), "target should not appear\n", "utf-8");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("GrepTool", () => {
  it("returns matching files by default using relative paths and safe exclusions", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-1", { pattern: "target" }, mockContext());

      expect(output.mode).toBe("files_with_matches");
      expect(output.filenames).toContain("alpha.ts");
      expect(output.filenames).toContain("beta.md");
      expect(output.filenames).not.toContain("node_modules/ignored.ts");
      expect(output.filenames).not.toContain("dist/ignored.ts");
      expect(output.filenames).not.toContain(".git/ignored");
      expect(output.numFiles).toBe(output.filenames.length);
    });
  });

  it("returns matching content lines in content mode", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-2", {
        pattern: "target",
        output_mode: "content",
      }, mockContext());

      expect(output.mode).toBe("content");
      expect(output.content).toContain("alpha.ts:");
      expect(output.content).toContain("beta.md:");
      expect(output.content).not.toContain("node_modules");
      expect(output.numLines).toBe(2);
    });
  });

  it("returns per-file counts in count mode", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-3", {
        pattern: "target",
        output_mode: "count",
      }, mockContext());

      expect(output.mode).toBe("count");
      expect(output.content).toContain("alpha.ts:1");
      expect(output.content).toContain("beta.md:1");
      expect(output.numFiles).toBe(2);
      expect(output.numMatches).toBe(2);
    });
  });

  it("filters files with glob", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-4", {
        pattern: "target",
        glob: "*.ts",
      }, mockContext());

      expect(output.filenames).toEqual(["alpha.ts"]);
    });
  });

  it("formats empty and non-empty results for the model", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const found = await tool.execute("grep-5", { pattern: "target" }, mockContext());
      const foundText = tool.formatResult!(found, "grep-5");
      expect(typeof foundText).toBe("string");
      expect(foundText).toContain("Found 2 files");
      expect(foundText).toContain("alpha.ts");

      const empty = await tool.execute("grep-6", { pattern: "missing" }, mockContext());
      const emptyText = tool.formatResult!(empty, "grep-6");
      expect(emptyText).toBe("No files found");
    });
  });

  it("validates that path exists", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const validation = await tool.validateInput!(
        { pattern: "target", path: "does-not-exist" },
        mockContext(),
      );

      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.message).toContain("Path does not exist");
      }
    });
  });
});
