# docs/cc 深度重构设计

> 对 `docs/cc/` 下 12 个 claude-code（cc）分析文档进行深度重构，建立统一的分析框架、更新内容、提升结构化程度，并与 ys-code 建立明确的关联。

---

## 1. Objective（目标）

**现状问题：**
- `docs/cc/` 下 12 个文件命名风格不统一（带日期/不带日期、中文/英文混合）
- 同一主题分散在多个文件中（如 compact 主题有 4 个文件）
- 缺乏统一的分析框架，阅读体验不一致
- 文档与 ys-code 的关联性弱，参考文档未能有效指导开发

**重构目标：**
1. 建立清晰的目录结构，按主题聚合文档
2. 统一分析框架（背景→原理→源码实现→对比→启示）
3. 更新补充 CC 源码的后续变更（基于最新源码状态）
4. 增加结构化输出（流程图、对比表格、关键结论摘要）
5. 每个分析文档明确标注 ys-code 当前状态和建议对齐方向

---

## 2. Project Structure（目录结构）

```
docs/cc/
├── README.md                          # 索引 + 导航 + 分析总览
├── compact/
│   ├── overview.md                    # CC Compact 系统完整分析
│   │                                   # 合并: compact-design + pi-mono-compact-design
│   ├── comparison.md                  # Compact 系统对比分析
│   │                                   # 合并: compact-comparison + persistence-comparison
│   └── followup.md                    # 保留: persistence-compact-followup
├── edit-tool/
│   ├── analysis.md                    # EditTool 源码深度分析
│   │                                   # 基于: cc-EditTool-源码分析
│   └── comparison.md                  # EditTool 实现对比
│                                       # 基于: edit-tool-comparison
├── message/
│   └── architecture.md                # 消息架构分析与重构建议
│                                       # 合并: message-architecture-analysis + message-architecture-redesign
├── system-prompt/
│   └── analysis.md                    # System Prompt 逐层分析
│                                       # 基于: system-prompt-analysis
└── skill/
    ├── mechanism.md                   # Skill 机制详解
    │                                   # 基于: skill_detail
    └── subagent.md                    # SubAgent 实现方案
                                        # 基于: subagent-design
```

---

## 3. 统一分析框架（每个文档的章节结构）

每个主题文档统一采用以下结构：

```markdown
# <主题>分析

## 1. 背景与定位
- 该机制在 CC 中的定位
- 为什么需要这个机制

## 2. 核心原理
- 设计思想
- 关键概念定义

## 3. 源码实现
- 关键代码路径
- 核心类/函数分析
- 执行流程（附流程图或步骤列表）

## 4. 与 ys-code 对比
| 维度 | CC 实现 | ys-code 当前状态 | 差异分析 |
|------|---------|------------------|----------|
| ...  | ...     | ...              | ...      |

## 5. 可借鉴点与建议
- CC 实现中值得 ys-code 对齐的具体点
- 优先级建议（P0/P1/P2）
- 实施难度评估

## 6. 参考链接
- CC 源码文件路径
- 相关 Issue/PR
```

---

## 4. 文档风格规范

### 4.1 文件名规范
- 全英文、kebab-case
- 不含日期前缀
- 反映内容主题（如 `overview.md` 而非 `compact-design.md`）

### 4.2 内容规范
- 技术术语保留英文（如 `compact`、`tool call`、`system prompt`）
- 代码块使用 TypeScript 语法高亮
- 流程使用 Mermaid 或文本流程图
- 对比内容必须使用表格形式

### 4.3 关联标注规范
- 每个与 ys-code 的对比点使用 `> **ys-code 现状:**` 标注
- 建议对齐方向使用 `> **建议:** [P0/P1/P2]` 标注

---

## 5. Commands（重构执行步骤）

按以下顺序执行，每个 slice 完成后自查：

### Slice 1: 目录骨架 + README
- 创建目录结构
- 编写 `README.md`（索引 + 总览）
- 验证：目录完整，无遗漏主题

### Slice 2: Compact 主题重构
- 合并 `compact-design.md` + `pi-mono-compact-design.md` → `compact/overview.md`
- 合并 `compact-comparison.md` + `persistence-comparison.md` → `compact/comparison.md`
- 保留并更新 `persistence-compact-followup.md` → `compact/followup.md`
- 验证：信息无遗漏，对比表格完整

### Slice 3: EditTool 主题重构
- 重构 `cc-EditTool-源码分析.md` → `edit-tool/analysis.md`
- 重构 `edit-tool-comparison.md` → `edit-tool/comparison.md`
- 补充最新的 EditTool 源码变更

### Slice 4: 消息架构重构
- 合并 `message-architecture-analysis.md` + `message-architecture-redesign.md` → `message/architecture.md`
- 重点强化 ys-code 消息架构的对齐建议

### Slice 5: System Prompt + Skill
- 重构 `system-prompt-analysis.md` → `system-prompt/analysis.md`
- 重构 `skill_detail.md` → `skill/mechanism.md`
- 重构 `subagent-design.md` → `skill/subagent.md`
- 补充 Skill/SubAgent 的最新实现细节

### Slice 6: 最终检查
- 检查所有内部链接是否有效
- 检查 README 索引是否完整
- 检查是否有内容遗漏（对比原始 12 个文件）

---

## 6. Testing Strategy（验证策略）

- **内容完整性检查**：对比原始 12 个文件，确认所有关键信息已迁移
- **链接有效性检查**：README 中的锚点链接、文件间引用链接
- **结构一致性检查**：所有文档是否遵循统一分析框架
- **可读性检查**：每个文档是否包含流程图/表格/摘要（至少一种结构化输出）

---

## 7. Boundaries（范围边界）

### 必须做的事
- 统一目录结构和文件名
- 统一分析框架
- 每个文档补充 ys-code 关联标注
- 保留原始分析的核心结论和源码路径

### 询问后再做的事
- 补充 CC 最新源码变更（如需查看最新源码，需确认是否使用 refer/claude-code-haha）
- 增加 Mermaid 流程图（如果项目不支持 Mermaid 渲染，改用文本流程图）
- 删除原始 12 个文件（在重构完成后统一删除）

### 不做的事
- 不动 `docs/cc/` 以外的任何目录
- 不修改 CC 源码（只分析现有文档）
- 不引入新的依赖或工具
- 不重写已被 ys-code 采纳并实现的方案（只标注"已对齐"）
