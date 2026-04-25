# EditTool 安全加固包设计文档

> 目标：补齐 ys-code EditTool 与 cc FileEditTool 的安全差距
> 范围：编码/行尾保持、Notebook 保护、Settings 保护、相似文件建议
> 日期：2026-04-25

---

## 一、设计概述

### 1.1 背景

当前 ys-code EditTool 已实现 read-before-write、脏写检测、引号规范化等核心安全机制。但与 cc 的 FileEditTool 对比，仍存在以下差距：

1. **编码/行尾不保持**：当前使用 `readFile(path, 'utf-8')`，假设文件永远是 UTF-8 且行尾为 `\n`，在 Windows 项目或含 BOM 的文件上会破坏原始格式
2. **无 Notebook 保护**：允许直接编辑 `.ipynb`，可能破坏 JSON 结构
3. **无 Settings 保护**：编辑 `.json` 配置文件时不校验语法合法性
4. **无相似文件建议**：文件不存在时仅返回"File does not exist"，不提示可能的正确文件名

### 1.2 核心思路

借鉴 cc 的实现方式，在现有 EditTool 基础上以**最小侵入**方式补齐 4 项安全机制：

- 提取**编码感知读写**到独立模块，供 EditTool 和 WriteTool 共用
- 在 `validateInput` 的合适位置插入各项检查，保持校验顺序合理
- 复用现有错误码体系，新增错误码 11（JSON 语法破坏）

---

## 二、编码与行尾保持

### 2.1 问题

当前代码：
```typescript
content = await readFile(fullPath, "utf-8");
await writeFile(fullPath, newContent, "utf-8");
```

问题：
- 无法读取 UTF-16 LE 编码的文件（Windows 常见）
- 将 `\r\n` 全部变为 `\n`，破坏 Windows 项目的行尾风格

### 2.2 方案

新增 `src/agent/tools/file-encoding.ts`，提供编码感知读写：

#### 2.2.1 数据结构

```typescript
export interface FileEncoding {
  /** 文件编码 */
  encoding: 'utf8' | 'utf16le';
  /** 原始行尾符 */
  lineEndings: '\n' | '\r\n';
}

export interface ReadResult {
  /** 内容（已统一为 \n，便于内部处理） */
  content: string;
  /** 原始编码信息 */
  encoding: FileEncoding;
}
```

#### 2.2.2 读取流程

```typescript
export async function readFileWithEncoding(path: string): Promise<ReadResult> {
  // 1. 读取原始 Buffer
  const buffer = await readFile(path);

  // 2. 检测编码（通过 BOM）
  const encoding = detectEncoding(buffer);

  // 3. 解码为字符串
  let content = buffer.toString(encoding);

  // 4. 检测行尾
  const lineEndings = detectLineEndings(content);

  // 5. 内部统一为 \n（便于字符串匹配）
  content = content.replaceAll('\r\n', '\n');

  return { content, encoding: { encoding, lineEndings } };
}
```

#### 2.2.3 写入流程

```typescript
export async function writeFileWithEncoding(
  path: string,
  content: string,
  encoding: FileEncoding,
): Promise<void> {
  // 1. 恢复原始行尾
  let finalContent = content;
  if (encoding.lineEndings === '\r\n') {
    finalContent = content.replaceAll('\n', '\r\n');
  }

  // 2. 按原始编码写入
  const buffer = Buffer.from(finalContent, encoding.encoding);
  await writeFile(path, buffer);
}
```

#### 2.2.4 检测规则

| 特征 | 编码判定 | 行尾判定 |
|------|---------|---------|
| 前 2 字节为 `FF FE` | `utf16le` | 原始内容中检测 `\r\n` |
| 否则 | `utf8` | 原始内容中检测 `\r\n` |

### 2.3 与现有代码集成

| 文件 | 修改点 |
|------|--------|
| `edit.ts` | `validateInput` 读取改用 `readFileWithEncoding`；`execute` 写入改用 `writeFileWithEncoding`；output 中携带 encoding 供后续使用 |
| `write.ts` | `execute` 先尝试读取原文件获取编码，若文件不存在则默认 utf8/\n；写入时用 `writeFileWithEncoding` |

### 2.4 边界情况

- **新文件**：无原始编码可保持，默认 utf8 + `\n`
- **空文件**：编码默认 utf8，行尾默认 `\n`
- **混合行尾**（部分 `\r\n` 部分 `\n`）：以 majority 为准，若数量相同默认 `\n`
- **无 BOM 的 UTF-16**：无法检测，按 utf8 处理（这是 cc 的同等限制）

---

## 三、Notebook 保护

### 3.1 问题

Jupyter Notebook（`.ipynb`）是 JSON 格式，内部包含 base64 编码的图片、执行计数、元数据等。直接字符串替换会破坏其结构，导致文件无法打开。

### 3.2 方案

在 `validateInput` 的文件存在性检查之后，读取内容之前插入：

```typescript
if (fullPath.endsWith('.ipynb')) {
  return {
    ok: false,
    message: "Jupyter notebooks must be edited with a specialized tool. Use NotebookEditTool instead.",
    errorCode: 5,
  };
}
```

**与 cc 对齐**：
- 触发条件：`fullPath.endsWith('.ipynb')`
- 错误码：`5`
- 消息：明确告知使用专用工具

### 3.3 校验顺序

Notebook 保护应放在**文件大小检查之后、读取文件内容之前**。

---

## 四、Settings 保护

### 4.1 问题

`.json` 配置文件（如 `.claude/settings.json`、`CLAUDE.md` 不是 JSON，但其他配置文件可能是）格式严格，误改可能导致：
- 项目规则失效
- 工具行为异常
- 配置解析失败

### 4.2 方案

编辑以 `.json` 结尾的文件时，在 `validateInput` 返回 `{ok: true}` 之前，**预演替换并校验 JSON 合法性**：

```typescript
if (fullPath.endsWith('.json')) {
  // 预演替换
  let preview: string;
  if (old_string === '') {
    preview = new_string;
  } else {
    preview = replace_all
      ? content.replaceAll(actualOldString, new_string)
      : content.replace(actualOldString, new_string);
  }

  // 校验 JSON
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
```

**新增错误码 11**：JSON 语法破坏。

### 4.3 范围

初期保护**所有 `.json` 文件**（简单且覆盖广）。后续如需细粒度控制（如仅保护 `.claude/` 目录），可再扩展。

### 4.4 与 cc 的差异

cc 有 `validateInputForSettingsFileEdit`，具体逻辑未在分析文档中展开。本设计采用「JSON 合法性校验」作为最小可行实现，后续可扩展为字段级保护。

---

## 五、相似文件建议

### 5.1 问题

模型偶尔拼错文件名（如 `edit.ts` → `editt.ts`），当前直接返回"File does not exist"，模型可能需要多次尝试才能找到正确文件。

### 5.2 方案

文件不存在时（`ENOENT`），扫描同级目录，用**简单启发式**找最相似的文件名。

#### 5.2.1 算法

```typescript
function findSimilarFile(targetPath: string): string | null {
  const dir = dirname(targetPath);
  const base = basename(targetPath);
  const files = await readdir(dir).catch(() => [] as string[]);

  // 过滤隐藏文件
  const candidates = files.filter(f => !f.startsWith('.'));

  // 策略 1：前缀匹配（前 3 个字符相同）
  const prefixMatch = candidates.find(f =>
    f.toLowerCase().startsWith(base.slice(0, 3).toLowerCase())
  );
  if (prefixMatch) return prefixMatch;

  // 策略 2：去掉扩展名后互相包含
  const targetNoExt = base.replace(/\.[^.]+$/, '').toLowerCase();
  const containmentMatch = candidates.find(f => {
    const fNoExt = f.replace(/\.[^.]+$/, '').toLowerCase();
    return fNoExt.includes(targetNoExt) || targetNoExt.includes(fNoExt);
  });
  if (containmentMatch) return containmentMatch;

  return null;
}
```

#### 5.2.2 保守策略

- 仅当匹配明显（前缀或包含关系）时才建议
- 如果目录文件多或匹配模糊，**宁可不提示**，也不给错误建议
- 不引入 Levenshtein 距离等复杂算法（避免过度设计）

#### 5.2.3 错误消息

```typescript
if (fileContent === null) {
  if (old_string === '') return { ok: true }; // 创建新文件

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
```

### 5.3 与 cc 的差异

cc 的 `findSimilarFile` 具体算法未在分析文档中展开。本设计采用「前缀匹配 + 包含匹配」的保守策略，避免引入复杂度。

---

## 六、validateInput 新执行顺序

```
1. 先读后写检查（canEdit）
2. 脏写检测第一层（mtime + content）
3. old_string === new_string
4. 文件大小检查（checkFileSize）
5. 【Notebook 保护】（.ipynb）
6. 读取文件（编码感知 → content + encoding）
7. 文件不存在 → 【相似文件建议】
8. old_string === '' 但文件已存在
9. old_string 存在性检查（引号规范化）
10. 多匹配检测
11. 【Settings 保护】（.json 预演 + JSON.parse）
12. 返回 {ok: true, meta: {encoding}}
```

---

## 七、修改文件清单

| 文件 | 类型 | 修改内容 | 测试文件 |
|------|------|---------|---------|
| `src/agent/tools/file-encoding.ts` | 新增 | 编码感知读写 | `file-encoding.test.ts` |
| `src/agent/tools/edit.ts` | 修改 | 集成 4 项安全机制 | `edit.test.ts`（扩展） |
| `src/agent/tools/write.ts` | 修改 | 写入时保持编码 | `write.test.ts`（扩展） |

---

## 八、测试策略

### 8.1 file-encoding.test.ts

| 测试用例 | 预期 |
|---------|------|
| 读取 UTF-8 文件 | encoding=utf8, lineEndings=\n |
| 读取 UTF-8 + CRLF | encoding=utf8, lineEndings=\r\n，content 中无 \r |
| 读取 UTF-16 LE + BOM | encoding=utf16le，内容正确解码 |
| 写入恢复 CRLF | 文件内容含 \r\n |
| 写入恢复 UTF-16 | 文件以 UTF-16 编码保存 |
| 空文件 | 默认 utf8 + \n |
| 混合行尾（多数 \r\n）| lineEndings=\r\n |
| 混合行尾（多数 \n）| lineEndings=\n |

### 8.2 edit.test.ts 扩展

| 测试用例 | 预期 |
|---------|------|
| 拒绝 .ipynb | errorCode=5 |
| 编辑 .json 后合法 | ok=true |
| 编辑 .json 后非法 | errorCode=11 |
| 文件不存在 + 相似文件 | 消息包含 "Did you mean:" |
| 文件不存在 + 无相似文件 | 消息不含 "Did you mean:" |
| 写入后保持 CRLF | 文件仍含 \r\n |
| 写入后保持 UTF-16 | 文件编码不变 |

### 8.3 write.test.ts 扩展

| 测试用例 | 预期 |
|---------|------|
| 覆盖文件保持原编码 | 文件编码不变 |
| 覆盖文件保持原行尾 | 行尾符不变 |

---

## 九、风险与回滚

| 风险 | 缓解措施 |
|------|---------|
| 编码检测误判 | 仅通过 BOM 检测 UTF-16，误判率低；误判定后表现为乱码，但文件内容不会丢失 |
| JSON 校验误伤合法编辑 | 仅校验语法（JSON.parse），不校验 schema；误伤概率低 |
| 相似文件建议错误 | 保守策略（仅前缀/包含匹配），模糊时不建议 |
| 测试覆盖不足 | 每项功能至少 2 个测试用例 |

**回滚策略**：
- `file-encoding.ts` 可独立回滚，不影响其他功能
- Notebook/Settings/相似文件建议均为 `validateInput` 中的独立 if 块，可单独注释掉

---

*本设计严格遵循最小侵入原则，每项功能独立可回滚。*
