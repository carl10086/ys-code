# ys-code Commands 加载功能 — 实施计划

## 背景

基于 spec `docs/ys-powers/specs/2026-04-28-commands-slash-design.md`，为 `ys-code` 实现从 `~/.claude/commands/` 和项目 `.claude/commands/` 加载 `.md` 文件作为 slash command 的能力。

---

## 组件依赖图

```
┌─────────────────────────────────────────┐
│  tui/app.tsx                            │
│  - 调用 getCommands(skillsPath, cwd)    │
└──────────────────┬──────────────────────┘
                   │
┌──────────────────▼──────────────────────┐
│  commands/index.ts                      │
│  - getCommands(): 合并所有命令源        │
│  - executeCommand(): 执行 slash command │
└──────────────────┬──────────────────────┘
                   │
     ┌─────────────┼─────────────┐
     │             │             │
     ▼             ▼             ▼
┌─────────┐  ┌──────────┐  ┌─────────────────────┐
│ BUILTIN │  │ skills/  │  │ loadCommandsDir.ts  │
│commands │  │loadSkills│  │  (NEW)              │
└─────────┘  │Dir       │  └──────────┬──────────┘
             └──────────┘             │
                          ┌───────────┼───────────┐
                          │           │           │
                          ▼           ▼           ▼
                    ┌─────────┐ ┌──────────┐ ┌──────────┐
                    │fs/promis│ │skills/   │ │.git 目录  │
                    │e (readdir│ │frontmatte│ │查找器     │
                    │readFile) │ │r.ts      │ │(内部实现) │
                    └─────────┘ └──────────┘ └──────────┘
```

**依赖说明：**
- `loadCommandsDir.ts` 仅依赖 Node.js 内置 `fs/promises` 和现有 `skills/frontmatter.ts`
- `commands/index.ts` 新增依赖 `loadCommandsDir.ts`
- `tui/app.tsx` 对 `commands/index.ts` 的调用方式微调（增加 `cwd` 参数）
- 无新增外部依赖

---

## 任务分解（垂直切片）

每个任务是一个**完整的可验证路径**，而非水平分层。任务按依赖顺序排列，低 ID 任务阻塞高 ID 任务。

| ID | 任务 | 阻塞 | 预估工作量 |
|----|------|------|-----------|
| T1 | 实现 `loadCommandsDir.ts` 核心加载模块 | — | 中 |
| T2 | 集成 commands 加载到命令体系 | T1 | 小 |
| T3 | 测试覆盖与端到端验证 | T1, T2 | 中 |

---

## 任务 T1：实现 `loadCommandsDir.ts` 核心加载模块

### 目标
新建 `src/commands/loadCommandsDir.ts`，提供两个导出函数，独立完成从文件系统到 `PromptCommand[]` 的完整转换。

### 实现要点

**`getProjectCommandDirs(cwd: string): Promise<string[]>`**
- 内部实现 `.git` 目录查找器（向上遍历，不依赖外部 `git` CLI）
- 从 `cwd` 开始向上遍历父目录
- 对每个目录检查 `<dir>/.claude/commands` 是否存在且为目录
- 收集所有存在的路径，按 "cwd → git root" 排序
- 停止条件：到达 `.git` 所在目录（git root）、到达 `os.homedir()`、到达文件系统根
- home 目录本身的 `.claude/commands/` 不纳入（由用户级加载处理）

**`loadCommandsFromDir(dirPath: string, source: 'userSettings' \| 'projectSettings'): Promise<PromptCommand[]>`**
- 使用 `fs.promises.readdir(dirPath, { withFileTypes: true })`
- 过滤条件：`entry.isFile() && entry.name.endsWith('.md')`
- 对每个文件：
  1. `readFile(path, 'utf-8')`
  2. `parseFrontmatter(content)` — 复用现有函数
  3. `parseSkillFrontmatterFields(frontmatter, markdownContent, skillName)` — 复用现有函数
  4. 命令名 = `entry.name.replace(/\.md$/, '')`
  5. 构建 `PromptCommand`（复用 `loadSkillsDir.ts` 中的 `createSkillCommand` 逻辑，或提取为共享函数）
- 错误处理：单文件失败记录 `logger.warn()` 并继续，目录不存在返回空数组

### 验收标准
- [ ] `getProjectCommandDirs('/tmp/repo/src')` 在 `/tmp/repo/.claude/commands/` 存在时返回包含该路径的数组
- [ ] `getProjectCommandDirs('/tmp/nogit')` 不在 git repo 中时遍历到 home 停止
- [ ] `loadCommandsFromDir('test-dir', 'userSettings')` 正确解析目录下所有 `.md` 文件为 `PromptCommand[]`
- [ ] 子目录中的 `.md` 文件被忽略
- [ ] 单个文件 frontmatter 解析失败不打断其他文件加载
- [ ] 目录不存在时返回空数组，不抛异常

### 验证步骤
1. 在临时目录创建测试结构：
   ```
   /tmp/test-cmds/
     hello.md          (含 frontmatter)
     subdir/
       ignored.md
     broken.md         (无效的 frontmatter)
   ```
2. 运行 `loadCommandsFromDir('/tmp/test-cmds', 'userSettings')`
3. 断言：返回 1 个命令（`hello`），`broken.md` 被跳过且不打断流程
4. 在临时目录创建 `.claude/commands/`，测试 `getProjectCommandDirs`

---

## 任务 T2：集成 commands 加载到命令体系

### 目标
将 T1 实现的加载能力接入现有命令系统，使用户级和项目级 commands 出现在 slash command 列表中。

### 实现要点

**修改 `src/commands/index.ts`**
- `getCommands()` 签名扩展为 `getCommands(skillsBasePath?: string, cwd: string = process.cwd())`
- 内部加载顺序（低优先级 → 高优先级）：
  1. `BUILTIN_COMMANDS`
  2. `loadSkillsFromSkillsDir(skillsBasePath)`（若提供了 `skillsBasePath`）
  3. `loadCommandsFromDir(join(homedir(), '.claude/commands'), 'userSettings')`
  4. 遍历 `getProjectCommandDirs(cwd)`，对每个目录调用 `loadCommandsFromDir(dir, 'projectSettings')`
- 合并策略：使用 `Map<string, Command>` 去重，后加载的覆盖先加载的
  - 项目级因最后加载而自然实现"项目级优先"
  - 多个项目级目录按"近者优先"（遍历顺序已是 cwd → root）
- 向后兼容：现有调用 `getCommands(".claude/skills")` 仍有效

**修改 `src/tui/app.tsx`**
- 将 `getCommands(".claude/skills")` 改为 `getCommands(".claude/skills", process.cwd())`
- 确保 `commands` state 包含加载的用户级和项目级命令

### 验收标准
- [ ] `getCommands()` 不传入参数时仍返回 `BUILTIN_COMMANDS`（向后兼容）
- [ ] `getCommands(".claude/skills", cwd)` 返回的结果包含 builtin + skills + user + project 四级命令
- [ ] 同名命令：项目级覆盖用户级，近处项目级覆盖远处项目级
- [ ] `tui/app.tsx` 启动后，`PromptInput` 的自动补全列表中出现 `.md` 文件对应的命令

### 验证步骤
1. 创建用户级命令：`mkdir -p ~/.claude/commands && echo '---\ndescription: Hello from user\n---\nHello' > ~/.claude/commands/hello.md`
2. 创建项目级命令：在项目目录 `.claude/commands/hello.md` 写入不同内容
3. 启动 ys-code
4. 在 `PromptInput` 中输入 `/`，确认 `hello` 出现在命令列表
5. 执行 `/hello`，确认注入的是项目级内容（验证覆盖策略）

---

## 任务 T3：测试覆盖与端到端验证

### 目标
为 T1 编写单元测试，并进行完整的手动端到端验证。

### 实现要点

**新建 `src/commands/loadCommandsDir.test.ts`**
- 使用 `tmp` 目录 + `fs/promises` 创建临时测试结构
- 测试用例覆盖 spec 中定义的所有场景（目录不存在、无 .md 文件、多文件、子目录忽略、frontmatter 失败、特殊文件名）
- `getProjectCommandDirs` 测试覆盖（cwd 下存在、上级存在、多层存在、无 git、home 排除）

**手动验证清单**
- 在真实目录结构中验证项目级覆盖用户级
- 验证 graceful degradation（删除目录后重启不崩溃）
- 验证与现有 skills 体系共存

### 验收标准
- [ ] `loadCommandsDir.test.ts` 所有测试用例通过
- [ ] 手动验证清单全部勾选（见下方验证步骤）
- [ ] 无回归：现有内置命令（`/exit`、`/clear` 等）功能正常
- [ ] 无回归：现有 skills 加载（`.claude/skills/`）功能正常

### 验证步骤

**单元测试：**
```bash
bun test src/commands/loadCommandsDir.test.ts
```

**手动验证清单：**
1. [ ] 在任意目录启动 ys-code，输入 `/help`，确认内置命令正常
2. [ ] 创建 `~/.claude/commands/test-cmd.md`，重启 ys-code，确认 `/test-cmd` 可用
3. [ ] 在项目根目录创建 `.claude/commands/test-cmd.md`（内容不同），在该目录启动 ys-code
4. [ ] 执行 `/test-cmd`，确认注入的是项目级内容（覆盖用户级）
5. [ ] 在项目子目录（如 `src/`）启动 ys-code，确认仍能加载项目根目录的 `.claude/commands/`
6. [ ] 删除 `~/.claude/commands/` 目录，重启 ys-code，确认不崩溃、仅剩内置命令 + skills
7. [ ] 创建一个 frontmatter 无效的 `.md` 文件，确认其他文件仍能正常加载

---

## 检查点（Checkpoints）

| 检查点 | 触发条件 | 验证内容 | 通过标准 |
|--------|---------|---------|---------|
| **CP1** | T1 完成后 | 核心加载模块可独立运行 | `loadCommandsDir.test.ts` 中基础测试用例通过 |
| **CP2** | T2 完成后 | commands 在 TUI 中可见 | 启动 ys-code 后，`PromptInput` 自动补全出现 `.md` 命令 |
| **CP3** | T3 完成后 | 功能完整交付 | 所有单元测试通过 + 手动验证清单全部勾选 |

**检查点规则：**
- 每个检查点必须**显式验证**后才能进入下一阶段
- CP1 和 CP2 允许在验证不通过时回退到对应任务修复
- CP3 为最终交付检查点，不通过不合并

---

## 风险与回滚方案

| 风险 | 影响 | 缓解措施 | 回滚方案 |
|------|------|---------|---------|
| `getCommands()` 签名变更破坏现有调用者 | 中 | 新增参数设为可选默认值 | 回滚 `index.ts` 变更，保留 `loadCommandsDir.ts` 供后续集成 |
| 文件系统遍历性能差（大量 .md 文件） | 低 | 仅扫描直接子目录，不递归 | 增加缓存层（memoize）— 但 spec 已明确不做缓存 |
| `parseFrontmatter` 对 .md 文件行为不一致 | 低 | 复用经过测试的现有解析器 | 回滚到仅使用 skills 加载 |
| 项目级遍历越界（如遍历到根目录） | 低 | 明确的停止条件（git root / home / 根目录） | 修复 `getProjectCommandDirs` 边界检查 |

---

## 附录：与 Spec 的对应关系

| Spec 章节 | 本计划覆盖 |
|-----------|-----------|
| 2.2 新增模块 `loadCommandsDir.ts` | T1 |
| 2.3 修改模块 `commands/index.ts` | T2 |
| 2.3 修改模块 `tui/app.tsx` | T2 |
| 5.1 单元测试 | T3 |
| 5.2 集成测试 | T3 |
| 5.3 手动验证 | T3 |
| 6.2 Must Have | CP3 验证 |
