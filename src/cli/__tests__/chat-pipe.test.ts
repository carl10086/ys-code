import { describe, it, expect } from "bun:test";
import { spawn } from "child_process";
import path from "path";

describe("chat.ts pipe mode", () => {
  it("输出不含 ANSI escape codes 且保持纯文本可管道化", async () => {
    const chatPath = path.resolve(process.cwd(), "src/cli/chat.ts");
    const child = spawn("bun", ["run", chatPath], {
      env: { ...process.env, FORCE_NON_TTY: "1" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write("/exit\n");
    child.stdin.end();

    let stdout = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    await new Promise<void>((resolve, reject) => {
      child.on("close", (code) => {
        if (code === 0 || code === null) {
          resolve();
        } else {
          reject(new Error(`Exit code ${code}`));
        }
      });
      child.on("error", reject);
    });

    expect(stdout).not.toContain("\x1b");
    expect(stdout).toContain("> ");
    // 由于 /exit 直接退出，不会触发 AI 回复块，但格式本身在其它测试中已覆盖
  });
});
