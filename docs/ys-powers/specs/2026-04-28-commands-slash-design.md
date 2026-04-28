# ys-code Commands 加载功能设计

## 1. Objective（目标）

为 `ys-code` 实现从文件系统加载 slash command 的能力，对齐 `claude-code-haha` 的 `~/.claude/commands/` 加载机制。

用户可在 `~/.claude/commands/` 或项目目录的 `.claude/commands/` 中放置 `.md` 文件，文件内容（含 frontmatter）将被解析为 `prompt` 类型的 Command，用户输入 `/command-name` 时将其内容作为 meta 消息注入当前对话。

### 成功标准
- [ ] `~/.claude/commands/*.md` 文件被正确识别并加载为 slash command
- [ ] 项目目录（从 cwd 向上遍历到 git root）的 `.claude/commands/*.md` 被正确加载
- [ ] 同名命令按"项目级优先、近者优先"策略覆盖
- [ ] 加载失败的文件不打断整体启动流程，仅记录 warn 日志
- [ ] 与现有 skills（`.claude/skills/`）加载体系共存，不破坏已有功能

---

## 2. Commands（架构与核心组件）

### 2.1 整体数据流

```
用户输入 /cmd-name
       |
       v
+---------------+
|  commands/index.ts:executeCommand()  |
+---------------+
       |
       v
+---------------+
|  findCommand()  ← 合并后的命令列表  |
+---------------+
       ^
       |
+------+------+------+------+
|      |      |      |
v      v      v      v
builtin  skills  user-cmds  project-cmds
(内置)   (技能)  (用户级)   (项目级)
```

### 2.2 新增模块

#### `src/commands/loadCommandsDir.ts`

核心职责：扫描目录、解析 markdown、生成 `PromptCommand`。

```typescript
/**
 * 从单个 commands 目录加载所有 .md 命令文件
 * 只扫描直接位于目录下的 *.md 文件，忽略子目录
 */
export async function loadCommandsFromDir(
  dirPath: string,
  source: 'userSettings' | 'projectSettings'
): Promise<PromptCommand[]>

/**
 * 从 cwd 向上遍历到 git root（或 home），收集所有存在的 .claude/commands/ 目录路径
 * 返回结果按"从 cwd 到 git root"排序（近者优先）
 */
export async function getProjectCommandDirs(cwd: string): Promise<string[]>
```

**`loadCommandsFromDir` 内部逻辑：**
1. 读取目录条目，过滤出直接的 `.md` 文件（`entry.isFile() && entry.name.endsWith('.md')`）
2. 对每个文件：读取内容 → `parseFrontmatter()` → `parseSkillFrontmatterFields()` → `createPromptCommand()`
3. 命令名 = 文件名去掉 `.md` 后缀（如 `commit.md` → `commit`）
4. 子目录完全忽略（不递归，不生成 namespace）

**`getProjectCommandDirs` 内部逻辑：**
1. 通过 `git rev-parse --show-toplevel` 获取 git root（失败则返回 `null`）
2. 从 `cwd` 开始向上遍历父目录
3. 对每个目录检查 `<dir>/.claude/commands` 是否存在且为目录
4. 若存在则加入结果列表
5. 停止条件：到达 git root、到达 home 目录、到达文件系统根目录
6. 返回结果保持"cwd 优先"的顺序

### 2.3 修改模块

#### `src/commands/index.ts`

**`getCommands()` 签名扩展：**

```typescript
export async function getCommands(
  skillsBasePath?: string,
  cwd: string = process.cwd()
): Promise<Command[]>
```

向后兼容：现有调用 `getCommands(".claude/skills")` 仍有效，`cwd` 默认 `process.cwd()`。

**内部加载与合并顺序：**

```
1. BUILTIN_COMMANDS        (内置命令，最低优先级)
2. skills (.claude/skills/)  (如果提供了 skillsBasePath)
3. user commands             (~/.claude/commands/*.md)
4. project commands          (从 cwd 到 git root 的所有 .claude/commands/*.md)
                              (最高优先级)
```

合并策略：使用 `Map<string, Command>` 按名称去重，后加载的覆盖先加载的。项目级 commands 因最后加载而自然实现"项目级优先"。

#### `src/tui/app.tsx`（调用点调整）

当前调用：
```typescript
getCommands(".claude/skills").then(setCommands);
```

调整为传入 `cwd`：
```typescript
getCommands(".claude/skills", process.cwd()).then(setCommands);
```

---

## 3. Project Structure（文件变更清单）

```
src/
  commands/
    index.ts              [MODIFY]  getCommands() 增加 commands 加载逻辑
    types.ts              [NO CHANGE] 现有 source 类型已足够
    loadCommandsDir.ts    [NEW]     commands 目录扫描与加载核心
  skills/
    frontmatter.ts        [NO CHANGE] 复用现有解析器
    loadSkillsDir.ts      [NO CHANGE] 与 commands 加载独立
  tui/
    app.tsx               [MODIFY]  调整 getCommands() 调用，传入 cwd
```

---

## 4. Code Style（编码规范）

### 4.1 风格对齐
- 与 `ys-code` 现有代码保持一致：2 空格缩进、双引号字符串（除 import path 外）、分号可选但保持文件内一致
- 新模块使用 `.ts` 扩展名，与现有文件一致

### 4.2 错误处理原则
- 目录不存在：静默返回空数组（`readdir` catch 返回 `[]`）
- 单个文件读取/解析失败：记录 `logger.warn()` 并跳过该文件，不影响其他文件加载
- `git rev-parse` 失败：视为不在 git repo 中，遍历到 home 目录停止

### 4.3 命名规范
- 函数名：`loadCommandsFromDir`、`getProjectCommandDirs` —— 动词开头，语义清晰
- 类型复用：直接复用现有的 `PromptCommand`、`SkillContentBlock`、`FrontmatterData`
- source 值：复用现有 `'userSettings'` 和 `'projectSettings'`，不新增类型分支

---

## 5. Testing Strategy（测试策略）

### 5.1 单元测试覆盖

**`src/commands/loadCommandsDir.test.ts`（新增）**

| 测试场景 | 期望行为 |
|---------|---------|
| 目录不存在 | 返回空数组，不抛错 |
| 目录存在但无 `.md` 文件 | 返回空数组 |
| 存在多个 `.md` 文件 | 正确解析为对应数量的 PromptCommand |
| 存在子目录（内含 `.md`） | 子目录被忽略 |
| frontmatter 解析失败 | 跳过该文件，其他文件正常加载 |
| 文件名含特殊字符 | 命令名正确提取（仅去掉 `.md`） |

**`getProjectCommandDirs` 测试（可在同一文件或单独文件）**

| 测试场景 | 期望行为 |
|---------|---------|
| cwd 下有 `.claude/commands/` | 包含该路径 |
| cwd 下无，但上级目录有 | 包含上级路径 |
| 多个层级都有 | 按 cwd → root 顺序返回 |
| 不在 git repo 中 | 遍历到 home 停止 |
| home 目录本身有 `.claude/commands/` | 不包含（home 属于 user 级） |

### 5.2 集成测试

- `getCommands()` 整合测试：验证 builtin + skills + user + project 四级合并结果正确
- 同名覆盖测试：项目级 `.claude/commands/commit.md` 应覆盖用户级 `~/.claude/commands/commit.md`

### 5.3 手动验证

在本地创建以下结构，启动 ys-code 验证：
```
~/.claude/commands/
  hello.md          (内容: "Say hello")

/tmp/test-project/.claude/commands/
  hello.md          (内容: "Say hello from project")
  bye.md            (内容: "Say goodbye")
```

验证：
1. 在 `/tmp/test-project` 下启动，`/hello` 应注入 "Say hello from project"
2. `/bye` 应可用
3. 在其他目录启动，`/hello` 应注入 "Say hello"

---

## 6. Boundaries（边界与约束）

### 6.1 明确不做的事（Out of Scope）
- ❌ **子目录 namespace**：`commands/git/commit.md` 不会被识别为 `git:commit`，子目录整体忽略
- ❌ **SKILL.md 目录格式**：不支持 `commands/commit/SKILL.md`，仅支持单文件 `.md`
- ❌ **Managed/Policy 目录**：不加载 `<managed>/.claude/commands/`，仅用户级 + 项目级
- ❌ **动态重载/文件监听**：启动时加载一次，运行时修改 `.md` 文件不会自动生效（需重启）
- ❌ **缓存机制**：不实现 memoize，每次 `getCommands()` 都重新读取文件系统（与现有 skills 加载行为一致）
- ❌ **shell 命令执行**：`.md` 中的 `!\`command\`` 语法不执行，原样注入（cc 的 `executeShellCommandsInPrompt` 不在此范围）
- ❌ **参数替换增强**：仅复用现有的 `$ARGUMENTS` 替换，不实现具名参数 `${arg1}`

### 6.2 必须做的事（Must Have）
- ✅ 用户级 `~/.claude/commands/*.md` 加载
- ✅ 项目级从 cwd 向上遍历到 git root 的 `.claude/commands/*.md` 加载
- ✅ 项目级优先覆盖用户级同名命令
- ✅ 加载失败 graceful degradation（单文件失败不阻断整体）
- ✅ 复用现有 frontmatter 解析体系（`parseFrontmatter`、`parseSkillFrontmatterFields`）
- ✅ 向后兼容：不破坏现有的 `getCommands(".claude/skills")` 调用

### 6.3 依赖假设
- 假设运行环境有 `git` CLI 可用（用于 `rev-parse --show-toplevel`）
- 假设用户主目录可通过 `os.homedir()` 获取
- 假设 `.md` 文件使用 UTF-8 编码

---

## 附录：参考实现对比

| 维度 | claude-code-haha | 本设计（ys-code） |
|------|-----------------|------------------|
| 用户级目录 | `~/.claude/commands/` | ✅ 相同 |
| 项目级目录 | 从 cwd 向上遍历到 git root | ✅ 相同 |
| 子目录处理 | 支持 namespace (`git:commit`) | ❌ 忽略子目录 |
| 文件格式 | `.md` 单文件 + `SKILL.md` 目录 | 仅 `.md` 单文件 |
| 优先级 | project > user > managed | project > user（无 managed） |
| 缓存 | memoize + 手动清除 | 无缓存（简化） |
| 动态发现 | 文件操作时动态加载 skills | 不做 |
| shell 执行 | `!\`cmd\`` 在加载时执行 | 不执行（简化） |
