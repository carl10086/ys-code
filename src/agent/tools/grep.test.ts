import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises";
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
    await writeFile(join(dir, ".env"), "SECRET_TARGET=target secret\n", "utf-8");
    await writeFile(join(dir, ".npmrc"), "//registry.example.test/:_authToken=target-token\n", "utf-8");
    await writeFile(join(dir, "private.pem"), "target private key\n", "utf-8");
    await writeFile(join(dir, "gamma.ts"), "nothing here\n", "utf-8");
    await writeFile(join(dir, "case.ts"), "TARGET uppercase\n", "utf-8");
    await writeFile(join(dir, "dash.txt"), "-flag-like-pattern\n", "utf-8");
    await writeFile(join(dir, "context.txt"), "before\nneedle\nafter\n", "utf-8");
    await writeFile(join(dir, "multi.ts"), "const value = {\n  field: true\n};\n", "utf-8");
    await mkdir(join(dir, "node_modules"), { recursive: true });
    await writeFile(join(dir, "node_modules", "ignored.ts"), "target should not appear\n", "utf-8");
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(join(dir, "dist", "ignored.ts"), "target should not appear\n", "utf-8");
    await mkdir(join(dir, ".git"), { recursive: true });
    await writeFile(join(dir, ".git", "ignored"), "target should not appear\n", "utf-8");
    await mkdir(join(dir, ".ssh"), { recursive: true });
    await writeFile(join(dir, ".ssh", "id_ed25519"), "target ssh key\n", "utf-8");
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
      expect(output.filenames).not.toContain(".env");
      expect(output.filenames).not.toContain(".npmrc");
      expect(output.filenames).not.toContain(".ssh/id_ed25519");
      expect(output.filenames).not.toContain("private.pem");
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
      expect(output.content).not.toContain("SECRET_TARGET");
      expect(output.content).not.toContain("_authToken");
      expect(output.content).not.toContain(".ssh/id_ed25519");
      expect(output.content).not.toContain("private.pem");
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

  it("rejects paths outside the workspace", async () => {
    await withFixture(async (dir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), "ys-grep-outside-"));
      try {
        await writeFile(join(outsideDir, "secret.txt"), "target secret\n", "utf-8");
        const tool = createGrepTool(dir);

        const absoluteValidation = await tool.validateInput!(
          { pattern: "target", path: join(outsideDir, "secret.txt") },
          mockContext(),
        );
        const parentValidation = await tool.validateInput!(
          { pattern: "target", path: "../" },
          mockContext(),
        );

        expect(absoluteValidation.ok).toBe(false);
        expect(parentValidation.ok).toBe(false);
        await expect(tool.execute("grep-outside", {
          pattern: "target",
          path: join(outsideDir, "secret.txt"),
        }, mockContext())).rejects.toThrow("relative to the workspace");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it("rejects symlinks that resolve outside the workspace", async () => {
    await withFixture(async (dir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), "ys-grep-symlink-"));
      try {
        await writeFile(join(outsideDir, "secret.txt"), "target secret\n", "utf-8");
        await symlink(outsideDir, join(dir, "outside-link"));
        const tool = createGrepTool(dir);

        const validation = await tool.validateInput!(
          { pattern: "target", path: "outside-link" },
          mockContext(),
        );

        expect(validation.ok).toBe(false);
        await expect(tool.execute("grep-symlink", {
          pattern: "target",
          path: "outside-link",
        }, mockContext())).rejects.toThrow("outside the workspace");
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it("treats dash-prefixed paths as paths, not ripgrep options", async () => {
    await withFixture(async (dir) => {
      const outsideDir = await mkdtemp(join(tmpdir(), "ys-grep-dash-path-"));
      try {
        await mkdir(join(dir, "--follow"), { recursive: true });
        await writeFile(join(dir, "--follow", "local.txt"), "target local\n", "utf-8");
        await writeFile(join(outsideDir, "secret.txt"), "secret outside\n", "utf-8");
        await symlink(outsideDir, join(dir, "outside-link"));
        const tool = createGrepTool(dir);

        const local = await tool.execute("grep-dash-path-local", {
          pattern: "target",
          path: "--follow",
        }, mockContext());
        const outside = await tool.execute("grep-dash-path-secret", {
          pattern: "secret",
          path: "--follow",
        }, mockContext());

        expect(local.filenames).toEqual(["--follow/local.txt"]);
        expect(outside.filenames).toEqual([]);
      } finally {
        await rm(outsideDir, { recursive: true, force: true });
      }
    });
  });

  it("rejects invalid numeric pagination and context values", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      for (const params of [
        { pattern: "target", head_limit: -1 },
        { pattern: "target", offset: -1 },
        { pattern: "target", output_mode: "content", "-A": 1.5 },
        { pattern: "target", output_mode: "content", context: -1 },
        { pattern: "target", head_limit: 5001 },
        { pattern: "target", offset: 5001 },
        { pattern: "target", output_mode: "content", "-A": 51 },
        { pattern: "target", output_mode: "content", "-B": 51 },
        { pattern: "target", output_mode: "content", "-C": 51 },
        { pattern: "target", output_mode: "content", context: 51 },
        { pattern: "x".repeat(8193) },
        { pattern: "target", path: "x".repeat(4097) },
        { pattern: "target", glob: "x".repeat(8193) },
        { pattern: "target", type: "x".repeat(129) },
      ] as any[]) {
        const validation = await tool.validateInput!(params, mockContext());
        expect(validation.ok).toBe(false);
      }
    });
  });

  it("supports case-insensitive search", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-7", {
        pattern: "target uppercase",
        "-i": true,
      } as any, mockContext());

      expect(output.filenames).toEqual(["case.ts"]);
    });
  });

  it("filters by ripgrep type", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-8", {
        pattern: "target",
        type: "ts",
      } as any, mockContext());

      expect(output.filenames).toEqual(["alpha.ts"]);
    });
  });

  it("supports head_limit and offset pagination", async () => {
    await withFixture(async (dir) => {
      await writeFile(join(dir, "delta.ts"), "target extra\n", "utf-8");
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-9", {
        pattern: "target",
        glob: "*.ts",
        head_limit: 1,
        offset: 1,
      } as any, mockContext());

      expect(output.filenames).toEqual(["delta.ts"]);
      expect((output as any).appliedLimit).toBe(1);
      expect((output as any).appliedOffset).toBe(1);
    });
  });

  it("defaults head_limit to 250 results", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 260; index += 1) {
        await writeFile(join(dir, `bulk-${String(index).padStart(3, "0")}.ts`), "target bulk\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-default-limit", {
        pattern: "target",
        glob: "*.ts",
      }, mockContext());

      expect(output.filenames).toHaveLength(250);
      expect((output as any).appliedLimit).toBe(250);
    });
  });

  it("supports comma and brace glob patterns", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const comma = await tool.execute("grep-comma-glob", {
        pattern: "target",
        glob: "*.ts,*.md",
      }, mockContext());
      const brace = await tool.execute("grep-brace-glob", {
        pattern: "target",
        glob: "*.{ts,md}",
      }, mockContext());

      expect(comma.filenames).toEqual(["alpha.ts", "beta.md"]);
      expect(brace.filenames).toEqual(["alpha.ts", "beta.md"]);
    });
  });

  it("supports content context lines with context taking precedence", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-10", {
        pattern: "needle",
        path: "context.txt",
        output_mode: "content",
        "-A": 0,
        "-B": 0,
        context: 1,
      } as any, mockContext());

      expect(output.content).toContain("before");
      expect(output.content).toContain("needle");
      expect(output.content).toContain("after");
      expect(output.content).toContain("context.txt-1-before");
      expect(output.content).toContain("context.txt:2:needle");
      expect(output.content).toContain("context.txt-3-after");
      expect(output.content).not.toContain(dir);
    });
  });

  it("includes filenames for single-file content and count searches", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const content = await tool.execute("grep-single-content", {
        pattern: "target",
        path: "alpha.ts",
        output_mode: "content",
      }, mockContext());
      const count = await tool.execute("grep-single-count", {
        pattern: "target",
        path: "alpha.ts",
        output_mode: "count",
      }, mockContext());

      expect(content.content).toContain("alpha.ts:1:");
      expect(count.content).toBe("alpha.ts:1");
      expect(count.numMatches).toBe(1);
    });
  });

  it("supports disabling line numbers in content mode", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-no-line-number", {
        pattern: "target",
        path: "alpha.ts",
        output_mode: "content",
        "-n": false,
      }, mockContext());

      expect(output.content).toContain("alpha.ts:export const target = 1;");
      expect(output.content).not.toContain("alpha.ts:1:");
    });
  });

  it("supports patterns that start with a dash", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-11", {
        pattern: "-flag-like-pattern",
      } as any, mockContext());

      expect(output.filenames).toEqual(["dash.txt"]);
    });
  });

  it("supports multiline matching", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-12", {
        pattern: "value = \\{\\n  field",
        multiline: true,
        output_mode: "content",
      } as any, mockContext());

      expect(output.content).toContain("multi.ts:");
      expect(output.numLines).toBeGreaterThan(0);
    });
  });

  it("applies the default limit to content and count results", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 260; index += 1) {
        await writeFile(join(dir, `many-${String(index).padStart(3, "0")}.txt`), "target many\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const content = await tool.execute("grep-content-limit", {
        pattern: "target many",
        glob: "*.txt",
        output_mode: "content",
      }, mockContext());
      const count = await tool.execute("grep-count-limit", {
        pattern: "target many",
        glob: "*.txt",
        output_mode: "count",
      }, mockContext());

      expect(content.numLines).toBe(250);
      expect(content.appliedLimit).toBe(250);
      expect(count.numFiles).toBe(250);
      expect(count.numMatches).toBe(250);
      expect(count.appliedLimit).toBe(250);
    });
  });

  it("allows head_limit 0 to return all matching files", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 260; index += 1) {
        await writeFile(join(dir, `unlimited-${String(index).padStart(3, "0")}.ts`), "target unlimited\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-unlimited", {
        pattern: "target unlimited",
        glob: "*.ts",
        head_limit: 0,
      }, mockContext());

      expect(output.filenames).toHaveLength(260);
      expect(output.appliedLimit).toBeUndefined();
    });
  });

  it("allows head_limit 0 for content and count results up to the safe cap", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 260; index += 1) {
        await writeFile(join(dir, `content-unlimited-${String(index).padStart(3, "0")}.txt`), "target content unlimited\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const content = await tool.execute("grep-content-unlimited", {
        pattern: "target content unlimited",
        glob: "*.txt",
        output_mode: "content",
        head_limit: 0,
      }, mockContext());
      const count = await tool.execute("grep-count-unlimited", {
        pattern: "target content unlimited",
        glob: "*.txt",
        output_mode: "count",
        head_limit: 0,
      }, mockContext());

      expect(content.numLines).toBe(260);
      expect(content.appliedLimit).toBeUndefined();
      expect(count.numFiles).toBe(260);
      expect(count.numMatches).toBe(260);
      expect(count.appliedLimit).toBeUndefined();
    });
  });

  it("applies offset and head_limit to content and count result windows", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 260; index += 1) {
        await writeFile(join(dir, `window-${String(index).padStart(3, "0")}.txt`), "target window\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const content = await tool.execute("grep-content-window", {
        pattern: "target window",
        glob: "*.txt",
        output_mode: "content",
        offset: 250,
        head_limit: 5,
      }, mockContext());
      const count = await tool.execute("grep-count-window", {
        pattern: "target window",
        glob: "*.txt",
        output_mode: "count",
        offset: 250,
        head_limit: 5,
      }, mockContext());

      expect(content.numLines).toBe(5);
      expect(content.appliedOffset).toBe(250);
      expect(content.appliedLimit).toBe(5);
      expect(count.numFiles).toBe(5);
      expect(count.numMatches).toBe(5);
      expect(count.appliedOffset).toBe(250);
      expect(count.appliedLimit).toBe(5);
    });
  });

  it("does not mark results truncated when the search exactly fills the requested window", async () => {
    await withFixture(async (dir) => {
      await writeFile(join(dir, "exact-0.txt"), "target exact\n", "utf-8");
      await writeFile(join(dir, "exact-1.txt"), "target exact\n", "utf-8");
      await writeFile(join(dir, "exact-2.txt"), "target exact\n", "utf-8");
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-exact-window", {
        pattern: "target exact",
        glob: "*.txt",
        output_mode: "count",
        offset: 1,
        head_limit: 2,
      }, mockContext());

      expect(output.numFiles).toBe(2);
      expect(output.appliedOffset).toBe(1);
      expect(output.truncated).toBeUndefined();
      expect(output.truncatedReason).toBeUndefined();
    });
  });

  it("caps unbounded output requests at a safe maximum", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 5200; index += 1) {
        await writeFile(join(dir, `cap-${String(index).padStart(4, "0")}.txt`), "target cap\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-safe-cap", {
        pattern: "target cap",
        glob: "*.txt",
        output_mode: "count",
        head_limit: 0,
      }, mockContext());

      expect(output.numFiles).toBe(5000);
      expect(output.appliedLimit).toBe(5000);
      expect(output.truncated).toBe(true);
      expect(output.truncatedReason).toBe("line_limit");
    });
  });

  it("caps unbounded files_with_matches requests at a safe maximum", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 5200; index += 1) {
        await writeFile(join(dir, `file-cap-${String(index).padStart(4, "0")}.txt`), "target file cap\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-file-safe-cap", {
        pattern: "target file cap",
        glob: "*.txt",
        head_limit: 0,
      }, mockContext());

      expect(output.numFiles).toBe(5000);
      expect(output.appliedLimit).toBe(5000);
      expect(output.truncated).toBe(true);
      expect(output.truncatedReason).toBe("line_limit");
    });
  });

  it("caps output by bytes for very long matching lines", async () => {
    await withFixture(async (dir) => {
      const longDir = join(
        dir,
        "long-path-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "long-path-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "long-path-cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "long-path-dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        "long-path-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        "long-path-ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      );
      await mkdir(longDir, { recursive: true });
      for (let index = 0; index < 4500; index += 1) {
        await writeFile(join(longDir, `byte-cap-${String(index).padStart(4, "0")}.txt`), "target byte\n", "utf-8");
      }
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-byte-cap", {
        pattern: "target byte",
        glob: "*.txt",
        output_mode: "content",
        head_limit: 0,
      }, mockContext());

      expect(output.truncated).toBe(true);
      expect(output.truncatedReason).toBe("byte_limit");
      expect(output.appliedLimit).toBe(5000);
    });
  });

  it("returns timeout truncation metadata when ripgrep exceeds the timeout", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 1200; index += 1) {
        await writeFile(join(dir, `timeout-${String(index).padStart(4, "0")}.txt`), "nothing timeout\n", "utf-8");
      }
      const previousTimeout = process.env.YS_GREP_TIMEOUT_MS;
      process.env.YS_GREP_TIMEOUT_MS = "1";
      try {
        const tool = createGrepTool(dir);
        const output = await tool.execute("grep-timeout", {
          pattern: "unmatched-timeout-pattern",
          glob: "*.txt",
          output_mode: "content",
          head_limit: 0,
        }, mockContext());

        expect(output.truncated).toBe(true);
        expect(output.truncatedReason).toBe("timeout");
        expect(output.appliedLimit).toBe(5000);
      } finally {
        if (previousTimeout === undefined) {
          delete process.env.YS_GREP_TIMEOUT_MS;
        } else {
          process.env.YS_GREP_TIMEOUT_MS = previousTimeout;
        }
      }
    });
  });

  it("rejects invalid ripgrep patterns", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      await expect(tool.execute("grep-invalid-regex", {
        pattern: "[",
      }, mockContext())).rejects.toThrow("ripgrep failed");
    });
  });

  it("formats empty count results as no matches found", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);

      const output = await tool.execute("grep-empty-count", {
        pattern: "missing",
        output_mode: "count",
      }, mockContext());

      expect(tool.formatResult!(output, "grep-empty-count")).toBe("No matches found");
    });
  });

  it("returns search_result render data for TUI rendering", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);
      const output = await tool.execute("grep-13", { pattern: "target" }, mockContext());

      expect(tool.renderResult).toBeDefined();
      const renderData = tool.renderResult!(output, "grep-13");

      expect(renderData).toEqual({
        type: "search_result",
        mode: "files_with_matches",
        numFiles: 2,
        filenames: ["alpha.ts", "beta.md"],
      });
    });
  });

  it("includes pagination and truncation metadata in render data", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 260; index += 1) {
        await writeFile(join(dir, `render-limit-${String(index).padStart(3, "0")}.txt`), "target render limit\n", "utf-8");
      }
      const tool = createGrepTool(dir);
      const output = await tool.execute("grep-render-limit", {
        pattern: "target render limit",
        glob: "*.txt",
        output_mode: "count",
        offset: 250,
        head_limit: 5,
      }, mockContext());

      expect(tool.renderResult!(output, "grep-render-limit")).toMatchObject({
        type: "search_result",
        mode: "count",
        appliedLimit: 5,
        appliedOffset: 250,
        truncated: true,
        truncatedReason: "line_limit",
      });
    });
  });

  it("formats limited count and file results without claiming totals", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 260; index += 1) {
        await writeFile(join(dir, `format-limit-${String(index).padStart(3, "0")}.txt`), "target format limit\n", "utf-8");
      }
      const tool = createGrepTool(dir);
      const countOutput = await tool.execute("grep-format-count", {
        pattern: "target format limit",
        glob: "*.txt",
        output_mode: "count",
        head_limit: 5,
      }, mockContext());
      const filesOutput = await tool.execute("grep-format-files", {
        pattern: "target format limit",
        glob: "*.txt",
        head_limit: 5,
      }, mockContext());

      const countText = tool.formatResult!(countOutput, "grep-format-count") as string;
      const filesText = tool.formatResult!(filesOutput, "grep-format-files") as string;

      expect(countText).toContain("Found 5 shown occurrences");
      expect(countText).not.toContain("total occurrences");
      expect(countText).toContain("limit: 5");
      expect(filesText).toContain("Found 5 files");
      expect(filesText).toContain("limit: 5");
    });
  });

  it("rejects when the tool call is already aborted", async () => {
    await withFixture(async (dir) => {
      const tool = createGrepTool(dir);
      const abortController = new AbortController();
      abortController.abort();

      await expect(tool.execute("grep-abort", { pattern: "target" }, {
        ...mockContext(),
        abortSignal: abortController.signal,
      })).rejects.toThrow("Grep search aborted");
    });
  });

  it("can abort while ripgrep is running", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 1000; index += 1) {
        await writeFile(join(dir, `abort-${String(index).padStart(4, "0")}.txt`), "target abort\n", "utf-8");
      }
      const tool = createGrepTool(dir);
      const abortController = new AbortController();
      const promise = tool.execute("grep-running-abort", {
        pattern: "target abort",
        output_mode: "content",
        head_limit: 0,
      }, {
        ...mockContext(),
        abortSignal: abortController.signal,
      });

      abortController.abort();

      await expect(promise).rejects.toThrow("Grep search aborted");
    });
  });

  it("keeps concurrent searches isolated when one is aborted", async () => {
    await withFixture(async (dir) => {
      for (let index = 0; index < 1000; index += 1) {
        await writeFile(join(dir, `isolated-${String(index).padStart(4, "0")}.txt`), "target isolated\n", "utf-8");
      }
      const tool = createGrepTool(dir);
      const abortController = new AbortController();

      const aborted = tool.execute("grep-aborted-concurrent", {
        pattern: "target isolated",
        output_mode: "content",
        head_limit: 0,
      }, {
        ...mockContext(),
        abortSignal: abortController.signal,
      });
      const completed = tool.execute("grep-completed-concurrent", {
        pattern: "target",
        path: "alpha.ts",
      }, mockContext());

      abortController.abort();

      await expect(aborted).rejects.toThrow("Grep search aborted");
      await expect(completed).resolves.toMatchObject({
        mode: "files_with_matches",
        filenames: ["alpha.ts"],
      });
    });
  });
});
