import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "fs/promises";
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

      expect(output.filenames).toEqual(["src/nested.ts"]);
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

  it("rejects overly long pattern and path values", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const longPattern = await tool.validateInput!(
        { pattern: "a".repeat(1001) },
        mockContext(),
      );
      expect(longPattern.ok).toBe(false);
      if (!longPattern.ok) {
        expect(longPattern.message).toContain("pattern must be at most 1000 characters");
      }

      const longPath = await tool.validateInput!(
        { pattern: "*.ts", path: "a".repeat(1001) },
        mockContext(),
      );
      expect(longPath.ok).toBe(false);
      if (!longPath.ok) {
        expect(longPath.message).toContain("path must be at most 1000 characters");
      }
    });
  });

  it("allows absolute paths inside the workspace", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const validation = await tool.validateInput!(
        { pattern: "*.ts", path: join(dir, "src") },
        mockContext(),
      );

      expect(validation.ok).toBe(true);
    });
  });

  it("rejects paths outside the workspace", async () => {
    await withFixture(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), "ys-glob-outside-"));
      try {
        const tool = createGlobTool(dir);

        const validation = await tool.validateInput!(
          { pattern: "*.ts", path: outside },
          mockContext(),
        );

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
          expect(validation.errorCode).toBe(1);
          expect(validation.message).toContain("outside the workspace");
        }
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("rejects symlinked directories that resolve outside the workspace", async () => {
    await withFixture(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), "ys-glob-symlink-target-"));
      try {
        await symlink(outside, join(dir, "outside-link"));
        const tool = createGlobTool(dir);

        const validation = await tool.validateInput!(
          { pattern: "*.ts", path: "outside-link" },
          mockContext(),
        );

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
          expect(validation.errorCode).toBe(1);
          expect(validation.message).toContain("outside the workspace");
        }
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("supports absolute glob patterns inside the workspace", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const output = await tool.execute("glob-5", { pattern: join(dir, "src", "*.ts") }, mockContext());

      expect(output.filenames).toEqual(["src/nested.ts"]);
      expect(output.filenames.every((filename) => !filename.startsWith(dir))).toBe(true);
    });
  });

  it("supports absolute literal file patterns inside the workspace", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const output = await tool.execute("glob-6", { pattern: join(dir, "alpha.ts") }, mockContext());

      expect(output.filenames).toEqual(["alpha.ts"]);
    });
  });

  it("rejects absolute glob patterns outside the workspace", async () => {
    await withFixture(async (dir) => {
      const outside = await mkdtemp(join(tmpdir(), "ys-glob-pattern-outside-"));
      try {
        await writeFile(join(outside, "outside.ts"), "export const outside = 1;\n", "utf-8");
        const tool = createGlobTool(dir);

        const validation = await tool.validateInput!(
          { pattern: join(outside, "*.ts") },
          mockContext(),
        );

        expect(validation.ok).toBe(false);
        if (!validation.ok) {
          expect(validation.message).toContain("outside the workspace");
        }
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  it("rejects absolute glob patterns outside the provided path", async () => {
    await withFixture(async (dir) => {
      const tool = createGlobTool(dir);

      const validation = await tool.validateInput!(
        { pattern: join(dir, "alpha.ts"), path: "src" },
        mockContext(),
      );

      expect(validation.ok).toBe(false);
      if (!validation.ok) {
        expect(validation.message).toContain("outside the search path");
      }
    });
  });

  it("does not mark results truncated when exactly at the result limit", async () => {
    await withFixture(async (dir) => {
      const manyDir = join(dir, "many-exact");
      await mkdir(manyDir, { recursive: true });
      for (let i = 0; i < 100; i++) {
        await writeFile(join(manyDir, `${String(i).padStart(3, "0")}.ts`), "export {}\n", "utf-8");
      }
      const tool = createGlobTool(dir);

      const output = await tool.execute("glob-7", { pattern: "*.ts", path: "many-exact" }, mockContext());

      expect(output.filenames).toHaveLength(100);
      expect(output.truncated).toBe(false);
    });
  });

  it("marks results truncated only after reading beyond the result limit", async () => {
    await withFixture(async (dir) => {
      const manyDir = join(dir, "many-over");
      await mkdir(manyDir, { recursive: true });
      for (let i = 0; i < 101; i++) {
        await writeFile(join(manyDir, `${String(i).padStart(3, "0")}.ts`), "export {}\n", "utf-8");
      }
      const tool = createGlobTool(dir);

      const output = await tool.execute("glob-8", { pattern: "*.ts", path: "many-over" }, mockContext());

      expect(output.filenames).toHaveLength(100);
      expect(output.truncated).toBe(true);
    });
  });

  it("honors an already aborted signal before running ripgrep", async () => {
    await withFixture(async (dir) => {
      const controller = new AbortController();
      controller.abort();
      const tool = createGlobTool(dir);

      await expect(
        tool.execute("glob-9", { pattern: "*.ts" }, { ...mockContext(), abortSignal: controller.signal }),
      ).rejects.toThrow("aborted");
    });
  });
});
