import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createGlobTool } from "./glob.js";
import type { TextContent } from "../../core/ai/index.js";

function mockContext(): any {
  return {
    abortSignal: new AbortController().signal,
    messages: [],
    tools: [],
    fileStateCache: {},
  };
}

async function withFixture<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "ys-glob-tool-"));
  try {
    await writeFile(join(dir, "alpha.ts"), "export const alpha = 1;\n", "utf-8");
    await writeFile(join(dir, "beta.md"), "# beta\n", "utf-8");
    await writeFile(join(dir, "gamma.ts"), "export const gamma = 1;\n", "utf-8");
    await mkdir(join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "src", "nested.ts"), "export const nested = 1;\n", "utf-8");
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function formatText(result: ReturnType<NonNullable<ReturnType<typeof createGlobTool>["formatResult"]>>): string {
  if (typeof result === "string") {
    return result;
  }
  return result.map((part) => (part as TextContent).text).join("\n");
}

describe("GlobTool", () => {
  it("returns matching files using relative paths", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const output = await tool.execute("glob-1", { pattern: "*.ts" }, mockContext());

      expect(output.filenames).toContain("alpha.ts");
      expect(output.filenames).toContain("gamma.ts");
      expect(output.filenames.every((filename) => !filename.startsWith(dir))).toBe(true);
      expect(output.numFiles).toBe(output.filenames.length);
      expect(output.truncated).toBe(false);
    });
  });

  it("formats empty and non-empty results for the model", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const found = await tool.execute("glob-2", { pattern: "*.md" }, mockContext());
      const foundText = formatText(tool.formatResult!(found, "glob-2"));
      expect(foundText).toContain("beta.md");

      const empty = await tool.execute("glob-3", { pattern: "*.missing" }, mockContext());
      const emptyText = formatText(tool.formatResult!(empty, "glob-3"));
      expect(emptyText).toBe("No files found");
    });
  });

  it("limits searches to the provided path", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const output = await tool.execute("glob-4", { pattern: "*.ts", path: "src" }, mockContext());

      expect(output.filenames).toEqual(["nested.ts"]);
    });
  });

  it("validates that path exists", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const validation = await tool.validateInput!(
        { pattern: "*.ts", path: "does-not-exist" },
        mockContext(),
      );

      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.errorCode).toBe(1);
        expect(validation.message).toContain("Directory does not exist");
      }
    });
  });

  it("validates that path is a directory", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const validation = await tool.validateInput!(
        { pattern: "*.ts", path: "alpha.ts" },
        mockContext(),
      );

      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.errorCode).toBe(2);
        expect(validation.message).toContain("Path is not a directory");
      }
    });
  });

  it("rejects string placeholders for omitted path", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      for (const path of ["undefined", "null"]) {
        const validation = await tool.validateInput!(
          { pattern: "*.ts", path },
          mockContext(),
        );

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
          expect(validation.errorCode).toBe(1);
          expect(validation.message).toContain("Omit path");
        }
      }
    });
  });
});
