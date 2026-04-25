// src/agent/tools/edit.ts
import { Type, type Static } from "@sinclair/typebox";
import { readFile, writeFile, stat, readdir } from "fs/promises";
import { dirname, basename } from "path";
import { checkFileSize, DIRTY_WRITE_MESSAGE } from "./file-guard.js";
import { readFileWithEncoding, writeFileWithEncoding } from "./file-encoding.js";
import { resolve } from "path";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";

const LEFT_SINGLE_CURLY_QUOTE = '‘'
const RIGHT_SINGLE_CURLY_QUOTE = '’'
const LEFT_DOUBLE_CURLY_QUOTE = '“'
const RIGHT_DOUBLE_CURLY_QUOTE = '”'

function normalizeQuotes(str: string): string {
  return str
    .replaceAll(LEFT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(RIGHT_SINGLE_CURLY_QUOTE, "'")
    .replaceAll(LEFT_DOUBLE_CURLY_QUOTE, '"')
    .replaceAll(RIGHT_DOUBLE_CURLY_QUOTE, '"')
}

function findActualString(fileContent: string, searchString: string): string | null {
  if (fileContent.includes(searchString)) {
    return searchString
  }
  const normalizedSearch = normalizeQuotes(searchString)
  const normalizedFile = normalizeQuotes(fileContent)
  const searchIndex = normalizedFile.indexOf(normalizedSearch)
  if (searchIndex !== -1) {
    return fileContent.substring(searchIndex, searchIndex + searchString.length)
  }
  return null
}

function isOpeningContext(chars: string[], index: number): boolean {
  if (index === 0) return true
  const prev = chars[index - 1]
  return /\s|[([{—–]/.test(prev)
}

function applyCurlyDoubleQuotes(str: string): string {
  const chars = [...str]
  const result: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === '"') {
      result.push(isOpeningContext(chars, i) ? LEFT_DOUBLE_CURLY_QUOTE : RIGHT_DOUBLE_CURLY_QUOTE)
    } else {
      result.push(chars[i]!)
    }
  }
  return result.join('')
}

function applyCurlySingleQuotes(str: string): string {
  const chars = [...str]
  const result: string[] = []
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "'") {
      const prev = i > 0 ? chars[i - 1] : undefined
      const next = i < chars.length - 1 ? chars[i + 1] : undefined
      const prevIsLetter = prev !== undefined && /\p{L}/u.test(prev)
      const nextIsLetter = next !== undefined && /\p{L}/u.test(next)
      if (prevIsLetter && nextIsLetter) {
        result.push(RIGHT_SINGLE_CURLY_QUOTE)
      } else {
        result.push(isOpeningContext(chars, i) ? LEFT_SINGLE_CURLY_QUOTE : RIGHT_SINGLE_CURLY_QUOTE)
      }
    } else {
      result.push(chars[i]!)
    }
  }
  return result.join('')
}

function preserveQuoteStyle(oldString: string, actualOldString: string, newString: string): string {
  if (oldString === actualOldString) return newString
  const hasDoubleQuotes = actualOldString.includes(LEFT_DOUBLE_CURLY_QUOTE) || actualOldString.includes(RIGHT_DOUBLE_CURLY_QUOTE)
  const hasSingleQuotes = actualOldString.includes(LEFT_SINGLE_CURLY_QUOTE) || actualOldString.includes(RIGHT_SINGLE_CURLY_QUOTE)
  if (!hasDoubleQuotes && !hasSingleQuotes) return newString
  let result = newString
  if (hasDoubleQuotes) result = applyCurlyDoubleQuotes(result)
  if (hasSingleQuotes) result = applyCurlySingleQuotes(result)
  return result
}

/**
 * 查找相似文件名（简单启发式）
 * @param targetPath 目标文件路径
 * @returns 相似文件名或 null
 */
async function findSimilarFile(targetPath: string): Promise<string | null> {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return null;
  }

  const candidates = files.filter((f) => !f.startsWith("."));
  if (candidates.length === 0) return null;

  // 策略 1：前缀匹配（前 3 个字符相同）
  const prefix = base.slice(0, 3).toLowerCase();
  const prefixMatch = candidates.find((f) =>
    f.toLowerCase().startsWith(prefix)
  );
  if (prefixMatch) return prefixMatch;

  // 策略 2：去掉扩展名后互相包含
  const targetNoExt = base.replace(/\.[^.]+$/, "").toLowerCase();
  const containmentMatch = candidates.find((f) => {
    const fNoExt = f.replace(/\.[^.]+$/, "").toLowerCase();
    return fNoExt.includes(targetNoExt) || targetNoExt.includes(fNoExt);
  });
  if (containmentMatch) return containmentMatch;

  return null;
}

const editSchema = Type.Object({
  file_path: Type.String({ description: "The absolute path to the file to modify" }),
  old_string: Type.String({ description: "The text to replace" }),
  new_string: Type.String({ description: "The text to replace it with (must be different from old_string)" }),
  replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences of old_string (default false)" })),
});

const editOutputSchema = Type.Object({
  filePath: Type.String(),
  oldString: Type.String(),
  newString: Type.String(),
  originalFile: Type.String(),
  replaceAll: Type.Boolean(),
});

type EditInput = Static<typeof editSchema>;
type EditOutput = Static<typeof editOutputSchema>;

export function createEditTool(cwd: string): AgentTool<typeof editSchema, EditOutput> {
  return defineAgentTool({
    name: "Edit",
    label: "Edit",
    description: `Performs exact string replacements in files.

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`,
    parameters: editSchema,
    outputSchema: editOutputSchema,
    isDestructive: true,

    validateInput: async (params: EditInput, context) => {
      const fullPath = resolve(cwd, params.file_path);

      // 【新增】先读后写检查
      const readCheck = context.fileStateCache.canEdit(fullPath);
      if (!readCheck.ok) {
        return {
          ok: false,
          message: readCheck.reason,
          errorCode: readCheck.errorCode,
        };
      }

      // 【新增】脏写检测第一层
      const stats = await stat(fullPath).catch(() => null);
      if (stats && readCheck.record) {
        const currentMtime = Math.floor(stats.mtimeMs);
        if (currentMtime > readCheck.record.timestamp) {
          const isFullRead =
            readCheck.record.offset === undefined &&
            readCheck.record.limit === undefined;
          if (!isFullRead) {
            return {
              ok: false,
              message: DIRTY_WRITE_MESSAGE,
              errorCode: 7,
            };
          }
          const content = await readFile(fullPath, 'utf-8').catch(() => null);
          if (content !== readCheck.record.content) {
            return {
              ok: false,
              message: DIRTY_WRITE_MESSAGE,
              errorCode: 7,
            };
          }
        }
      }

      // 1. old_string === new_string
      if (params.old_string === params.new_string) {
        return {
          ok: false,
          message: "No changes to make: old_string and new_string are exactly the same.",
          errorCode: 1,
        };
      }

      await checkFileSize(fullPath);

      // 【新增】Notebook 保护
      if (fullPath.endsWith(".ipynb")) {
        return {
          ok: false,
          message: "Jupyter notebooks must be edited with a specialized tool. Use NotebookEditTool instead.",
          errorCode: 5,
        };
      }

      // 2. 读取文件（编码感知）
      let content: string;
      try {
        const result = await readFileWithEncoding(fullPath);
        content = result.content;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          // 空 old_string 表示创建新文件 — 允许
          if (params.old_string === "") {
            return { ok: true };
          }
          const similar = await findSimilarFile(fullPath);
          const message = similar
            ? `File does not exist. Did you mean: ${similar}?`
            : "File does not exist.";
          return {
            ok: false,
            message,
            errorCode: 4,
          };
        }
        throw e;
      }

      // 文件存在但 old_string 为空 — 拒绝（不能创建已存在的文件）
      if (params.old_string === "") {
        return {
          ok: false,
          message: "Cannot create new file - file already exists.",
          errorCode: 3,
        };
      }

      // 3. old_string 是否存在于文件中（支持引号规范化匹配）
      const actualOldString = findActualString(content, params.old_string)
      if (!actualOldString) {
        return {
          ok: false,
          message: `String to replace not found in file.\nString: ${params.old_string}`,
          errorCode: 8,
        };
      }

      // 4. 多匹配检测
      const matches = content.split(actualOldString).length - 1;
      if (matches > 1 && !params.replace_all) {
        return {
          ok: false,
          message: `Found ${matches} matches of the string to replace, but replace_all is false. To replace all occurrences, set replace_all to true. To replace only one occurrence, please provide more context to uniquely identify the instance.\nString: ${params.old_string}`,
          errorCode: 9,
        };
      }

      // 【新增】Settings 保护：JSON 文件编辑后必须仍是合法 JSON
      if (fullPath.endsWith(".json")) {
        let preview: string;
        if (params.old_string === "") {
          preview = params.new_string;
        } else {
          const actualNewString = preserveQuoteStyle(params.old_string, actualOldString, params.new_string);
          preview = params.replace_all
            ? content.replaceAll(actualOldString, actualNewString)
            : content.replace(actualOldString, actualNewString);
        }
        try {
          JSON.parse(preview);
        } catch {
          return {
            ok: false,
            message: "Edit would result in invalid JSON. Please check your new_string.",
            errorCode: 11,
          };
        }
      }

      return { ok: true };
    },

    async execute(_toolCallId, params, context) {
      const fullPath = resolve(cwd, params.file_path);
      const { old_string, new_string, replace_all = false } = params;

      let content: string;
      let fileEncoding: { encoding: "utf8" | "utf16le"; lineEndings: "\n" | "\r\n" } = {
        encoding: "utf8",
        lineEndings: "\n",
      };
      try {
        const result = await readFileWithEncoding(fullPath);
        content = result.content;
        fileEncoding = result.encoding;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          content = "";
        } else {
          throw e;
        }
      }

      // 【新增】二次脏写检测
      const record = context.fileStateCache.get(fullPath);
      const stats = await stat(fullPath).catch(() => null);
      if (stats && record) {
        const currentMtime = Math.floor(stats.mtimeMs);
        if (currentMtime > record.timestamp) {
          const isFullRead = record.offset === undefined && record.limit === undefined;
          const contentUnchanged = isFullRead && content === record.content;
          if (!contentUnchanged) {
            throw new Error(DIRTY_WRITE_MESSAGE);
          }
        }
      }

      // 空 old_string 表示创建新文件
      let newContent: string;
      let actualOldString: string;
      if (old_string === "") {
        newContent = new_string;
        actualOldString = old_string;
      } else {
        actualOldString = findActualString(content, old_string) || old_string;
        const actualNewString = preserveQuoteStyle(old_string, actualOldString, new_string);
        newContent = replace_all
          ? content.replaceAll(actualOldString, actualNewString)
          : content.replace(actualOldString, actualNewString);
      }

      await writeFileWithEncoding(fullPath, newContent, fileEncoding);

      // 【新增】更新缓存
      const newStats = await stat(fullPath);
      context.fileStateCache.recordEdit(fullPath, newContent, Math.floor(newStats.mtimeMs));

      return {
        filePath: fullPath,
        oldString: actualOldString,
        newString: new_string,
        originalFile: content,
        replaceAll: replace_all,
      };
    },

    formatResult(output, _toolCallId) {
      if (output.replaceAll) {
        return [{
          type: "text" as const,
          text: `The file ${output.filePath} has been updated. All occurrences were successfully replaced.`,
        }];
      }
      return [{
        type: "text" as const,
        text: `The file ${output.filePath} has been updated successfully.`,
      }];
    },
  });
}
