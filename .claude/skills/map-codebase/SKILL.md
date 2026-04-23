---
name: map-codebase
description: Use when analyzing a project's codebase structure and generating architecture documentation, especially before onboarding, refactoring, or creating implementation plans that require understanding current code organization
---

# 代码库架构映射

## Overview

分析代码库架构并生成结构化 ARCHITECTURE.md 的技术。核心原则：**文档服务于未来的开发者**，必须包含具体文件路径和规定性指导，而非单纯描述现状。

## When to Use

- 新项目 onboarding 时理解代码库结构
- 重大重构或添加功能前了解当前状态
- 生成 implementation plan 前获取代码库上下文
- 架构文档过期或缺失时更新

**不要用于：**
<NEVER>
- 少于 5 个文件的 trivial 代码库
- 完全空白的 greenfield 项目
</NEVER>

## Core Pattern

### 输出地址

<CRITICAL>
生成的架构文档必须写入项目的 `docs/codebase/ARCHITECTURE.md`。如果 `docs/codebase/` 目录不存在，先创建它。
</CRITICAL>

**不要输出到：**
- `.planning/codebase/`（这是 gsd 的路径，不是本项目）
- 项目根目录
- 其他自定义位置

### 1. 深入探索（Explore Deeply）

<IMPORTANT>
不要只做 `ls` 和 `find`。必须阅读关键文件的内容：
</IMPORTANT>

- **依赖文件**：`package.json`、`Cargo.toml`、`go.mod`、`requirements.txt`, `mvn.pom`, `build.gralde` , `pyproject.toml`
- **入口文件**：`src/index.*`、`src/main.*`、`src/app.*`、`app/page.*`
- **配置文件**：`tsconfig.json`、`vite.config.*`、`.eslintrc.*`
- **核心模块**：业务逻辑实现代码（至少读 3-5 个关键文件）

**判断文件是否关键的方法**：如果删除它项目就无法运行，它就是关键文件。

### 2. 使用规定性语言（Be Prescriptive）

文档指导未来的 Claude 实例写代码。描述现状没有用，告诉他们应该怎么做：

❌ "项目使用 camelCase"
✅ "Use camelCase for functions"

❌ "测试文件放在 __tests__/ 目录"
✅ "Place test files in `__tests__/` adjacent to source files"

### 3. 必须包含文件路径

每一处架构描述都必须关联到具体文件。没有文件路径的文档无法导航：

❌ "UserService 处理用户逻辑"
✅ "`src/services/user.ts` 中的 `UserService` 处理用户逻辑"

❌ "使用 Stripe 进行支付"
✅ "`src/payments/stripe.ts` 使用 `@stripe/stripe-js` 处理支付"

### 4. 遵循标准 ARCHITECTURE.md 模板

不要自己发明结构。必须包含以下章节：

| 章节 | 内容 | 为什么必须 |
|------|------|-----------|
| **Pattern Overview** | 架构模式名称（MVC、微服务、分层等） | 让读者一眼理解整体组织方式 |
| **Layers** | 每层职责、位置、包含内容、依赖关系 | 指导新代码应该放在哪一层 |
| **Data Flow** | 请求/数据如何流经各层 | 理解变更的影响范围 |
| **Key Abstractions** | 核心接口/类/模块及其用途 | 避免重复造轮子 |
| **Entry Points** | 程序启动位置、触发方式 | 调试和扩展的起点 |
| **Error Handling** | 错误处理策略和模式 | 保持代码一致性 |
| **Cross-Cutting Concerns** | 日志、验证、认证等横切关注点 | 避免散落在各处的重复逻辑 |
| **Where to Add New Code** | 新功能、新模块、新测试的放置位置 | 最直接的操作指导 |

### 5. 安全规则

绝不读取敏感文件内容：
- `.env`、`.env.*` — 只记录存在性
- `credentials.*`、`secrets.*`、`*secret*`
- `*.pem`、`*.key`、SSH 私钥
- `.npmrc`、`.pypirc`（可能包含 auth token）

**如果文档中引用了这些文件，只写：** "`.env` 存在 — 包含环境配置"

## Common Mistakes

| 错误 | 后果 | 正确做法 |
|------|------|---------|
| 只扫描目录不读代码 | 文档只有骨架没有血肉 | 阅读关键文件的实现逻辑 |
| 使用描述性语言 | 对未来开发者没有指导作用 | 使用规定性语言 "Use X" |
| 缺少文件路径 | 文档无法导航到具体代码 | 每个描述都包含 \`file/path\` |
| 自己发明文档结构 | 遗漏关键架构信息 | 严格遵循标准模板 |
| 缺少 "Where to Add New Code" | 开发者不知道新功能放哪里 | 必须包含新代码放置指南 |
| 遗漏关键配置文件 | 开发者不知道构建/部署方式 | 检查并记录所有配置文件 |
| 读取 .env 等敏感文件 | 密钥泄露到 git 历史 | 只记录存在性，不读内容 |

## Rationalization Table

当想偷懒时，这些借口会出现：

| 借口 | 现实 |
|------|------|
| "目录结构已经说明一切" | 目录结构只看表面，代码逻辑才能说明架构 |
| "描述性语言更安全，不会错" | 描述性语言对未来开发者没有指导作用 |
| "文件路径太长影响阅读" | 没有文件路径的文档无法导航到具体代码 |
| "模板太死板，我想灵活处理" | 标准模板确保所有关键信息都被覆盖，不遗漏 |
| "我已经看了足够多的文件" | 关键文件必须读到，不能凭感觉判断 |
| "这个项目太简单不需要深入" | 简单项目的架构文档可以更短，但关键文件仍要读 |
| "我先写个初稿，后续再补充" | 初稿如果没有文件路径和规定性语言，后续也不会补充 |

## Red Flags — STOP and Fix

- 文档中没有反引号包裹的文件路径
- 章节标题与标准模板不符
- 只有 "项目使用 X" 而没有 "Use X"
- 没有 "Where to Add New Code" 章节
- 读取了 `.env` 或其他敏感文件内容
- 只探索了目录结构，没有阅读任何代码文件内容

**出现以上任何一条 = 文档不合格，必须重写。**
