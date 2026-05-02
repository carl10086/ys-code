import * as fs from "node:fs";
import * as path from "node:path";
import type { Entry, HeaderEntry } from "./entry-types.js";
import { logger } from "../utils/logger.js";

export class SessionStorage {
  constructor(private readonly baseDir: string) {
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    }
    try {
      fs.chmodSync(baseDir, 0o700);
    } catch (error) {
      logger.warn("Unable to enforce private session directory permissions", {
        baseDir,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  createSession(sessionId: string, cwd: string): string {
    const fileName = `${Date.now()}_${sessionId}.jsonl`;
    const filePath = path.join(this.baseDir, fileName);

    const header: HeaderEntry = {
      type: "header",
      uuid: this.generateUuid(),
      parentUuid: null,
      timestamp: Date.now(),
      version: 1,
      sessionId,
      cwd,
    };

    fs.writeFileSync(filePath, JSON.stringify(header) + "\n", { encoding: "utf-8", mode: 0o600 });
    fs.chmodSync(filePath, 0o600);
    return filePath;
  }

  appendEntry(filePath: string, entry: Entry): void {
    const line = JSON.stringify(entry) + "\n";
    fs.appendFileSync(filePath, line, { encoding: "utf-8" });
    fs.chmodSync(filePath, 0o600);
  }

  readAllEntries(filePath: string): Entry[] {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const entries: Entry[] = [];

    for (const [index, line] of lines.entries()) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as Entry;
        entries.push(entry);
      } catch {
        logger.warn("Skipping corrupted line in session file", {
          filePath,
          lineIndex: index,
          byteLength: Buffer.byteLength(line),
        });
      }
    }

    return entries;
  }

  findLatestSessionFile(): string | null {
    const files = fs.readdirSync(this.baseDir)
      .filter(f => f.endsWith(".jsonl"))
      .map(f => ({
        name: f,
        path: path.join(this.baseDir, f),
        mtime: fs.statSync(path.join(this.baseDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime);

    return files.length > 0 ? files[0].path : null;
  }

  private generateUuid(): string {
    return crypto.randomUUID();
  }
}
