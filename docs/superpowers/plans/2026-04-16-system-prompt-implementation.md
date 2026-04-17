# System Prompt 架构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 ys-code 的 `Agent` 引入 `string[]` 结构的 system prompt，支持 static section 缓存、dynamic section 实时更新，并在 Anthropic provider 中正确分配 `cache_control`。

**Architecture:** 在 `src/agent/system-prompt/` 下建立 section 定义 + 调度缓存层；`Agent` 通过 `buildSystemPrompt` 生成 `string[]`；`Context.systemPrompt` 和 `AgentLoopConfig.systemPrompt` 扩展为 `string | string[]`；Anthropic provider 按 `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 切分 static/dynamic block。

**Tech Stack:** TypeScript, Bun, `@anthropic-ai/sdk`, `@sinclair/typebox`

**规则提醒:** 请严格遵循 `.claude/rules/code.md`（Simplicity First、Surgical Changes、Goal-Driven Execution）和 `.claude/rules/typescript.md`（结构体优先用 interface、字段加中文注释）。

---

## 文件变更总览

| 文件 | 操作 | 职责 |
|------|------|------|
| `src/core/ai/types.ts` | 修改 | `Context.systemPrompt` 扩展为 `string \| string[]` |
| `src/agent/types.ts` | 修改 | `AgentLoopConfig.systemPrompt` 扩展为 `string \| string[]` |
| `src/agent/system-prompt/types.ts` | 创建 | `SystemPromptContext`、`SystemPromptSection`、`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` |
| `src/agent/system-prompt/sections/*.ts` | 创建 | 11 个 section 的内容定义 |
| `src/agent/system-prompt/systemPrompt.ts` | 创建 | section 缓存调度器，`buildSystemPrompt` 入口 |
| `src/agent/agent.ts` | 修改 | 挂载 `buildSystemPrompt`，`createLoopConfig` 异步化，`reset` 清空缓存 |
| `src/core/ai/providers/anthropic.ts` | 修改 | `buildParams` 支持 `string[]`，按 boundary 切分并分配 `cache_control` |
| `src/agent/system-prompt/systemPrompt.test.ts` | 创建 | 缓存命中、boundary 插入、异常降级测试 |

---

### Task 1: 扩展核心类型层

**Files:**
- Modify: `src/core/ai/types.ts:181-188`
- Modify: `src/agent/types.ts:133-144`

- [ ] **Step 1: 修改 `Context.systemPrompt` 类型**

  在 `src/core/ai/types.ts` 中，将 `Context` 接口的 `systemPrompt` 字段改为 `string | string[]`：

  ```typescript
  export interface Context {
    /** 系统提示词 */
    systemPrompt?: string | string[];
    /** 消息列表 */
    messages: Message[];
    /** 工具列表 */
    tools?: Tool[];
  }
  ```

- [ ] **Step 2: 修改 `AgentLoopConfig.systemPrompt` 类型**

  在 `src/agent/types.ts` 中（`AgentLoopConfig` 接口），增加 `systemPrompt` 字段声明：

  ```typescript
  export interface AgentLoopConfig extends SimpleStreamOptions {
    // ... 保留现有字段不变
    /** 系统提示词（支持 section 数组） */
    systemPrompt?: string | string[];
    // ...
  }
  ```

  注意：如果 `AgentLoopConfig` 之前没有显式声明 `systemPrompt`，现在需要新增；如果已经通过继承获得，可能需要检查是否冲突。当前 `AgentLoopConfig extends SimpleStreamOptions`，而 `SimpleStreamOptions` 不包含 `systemPrompt`，所以直接添加即可。

- [ ] **Step 3: 验证类型检查通过**

  Run: `bun tsc --noEmit`
  Expected: PASS（本次只改类型，不应该引入新错误）

- [ ] **Step 4: Commit**

  ```bash
  git add src/core/ai/types.ts src/agent/types.ts
  git commit -m "types: extend systemPrompt to string | string[]"
  ```

---

### Task 2: 创建 system-prompt 类型定义

**Files:**
- Create: `src/agent/system-prompt/types.ts`

- [ ] **Step 1: 编写 types.ts**

  ```typescript
  // src/agent/system-prompt/types.ts
  import type { AgentTool } from "../types.js";
  import type { Model } from "../../core/ai/types.js";

  /** 构建 system prompt 所需的上下文 */
  export interface SystemPromptContext {
    /** 当前工作目录 */
    cwd: string;
    /** 可用工具列表 */
    tools: AgentTool<any>[];
    /** 当前模型 */
    model: Model<any>;
    /** memory 文件内容（可选） */
    memoryFiles?: string[];
    /** 其他动态状态（可扩展） */
    [key: string]: unknown;
  }

  /** Section 计算函数 */
  export type SectionCompute = (context: SystemPromptContext) => Promise<string>;

  /** Section 定义 */
  export interface SystemPromptSection {
    /** section 名称 */
    name: string;
    /** 内容计算函数 */
    compute: SectionCompute;
    /** 缓存键生成函数；返回 undefined 表示 dangerous（每轮强制重算） */
    getCacheKey?: (context: SystemPromptContext) => string | undefined;
  }

  /** 数组中用于分隔 static 与 dynamic sections 的边界标记 */
  export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "\n\n=== DYNAMIC SYSTEM PROMPT SECTIONS ===\n\n";
  ```

- [ ] **Step 2: 验证类型检查通过**

  Run: `bun tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Commit**

  ```bash
  git add src/agent/system-prompt/types.ts
  git commit -m "feat(system-prompt): add SystemPromptContext and section types"
  ```

---

### Task 3: 创建 Section 定义文件

**Files:**
- Create: `src/agent/system-prompt/sections/intro.ts`
- Create: `src/agent/system-prompt/sections/system.ts`
- Create: `src/agent/system-prompt/sections/doing-tasks.ts`
- Create: `src/agent/system-prompt/sections/actions.ts`
- Create: `src/agent/system-prompt/sections/using-your-tools.ts`
- Create: `src/agent/system-prompt/sections/tone-and-style.ts`
- Create: `src/agent/system-prompt/sections/output-efficiency.ts`
- Create: `src/agent/system-prompt/sections/session-specific-guidance.ts`
- Create: `src/agent/system-prompt/sections/memory.ts`
- Create: `src/agent/system-prompt/sections/env-info.ts`
- Create: `src/agent/system-prompt/sections/summarize-tool-results.ts`

- [ ] **Step 1: 编写 static sections（7 个）**

  `intro.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    return "你是一个 AI 编程助手，帮助用户完成软件开发任务。";
  };
  ```

  `system.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    return "你运行在一个基于 Bun + TypeScript + OpenTUI 的环境中。";
  };
  ```

  `doing-tasks.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    return [
      "处理任务时遵循以下原则：",
      "- 先读取相关代码，理解上下文后再做修改",
      "- 以目标驱动：明确用户想要什么结果",
      "- 只改动与请求直接相关的代码",
    ].join("\n");
  };
  ```

  `actions.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    return [
      "你可以执行的操作包括：",
      "- 读取、编辑、创建文件",
      "- 运行 shell 命令",
      "- 使用工具与外部环境交互",
      "- 在不确定时向用户提问",
    ].join("\n");
  };
  ```

  `using-your-tools.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async (context) => {
    if (context.tools.length === 0) {
      return "当前没有可用的工具。";
    }
    const lines = [
      "当前可用的工具：",
      ...context.tools.map((t) => `- ${t.name}: ${t.description}`),
      "使用工具时请提供准确的参数。",
    ];
    return lines.join("\n");
  };
  ```

  `tone-and-style.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    return [
      "输出风格要求：",
      "- 使用简体中文与用户交流",
      "- 保持简洁，避免不必要的道歉",
      "- 技术术语和代码标识符保持原文",
    ].join("\n");
  };
  ```

  `output-efficiency.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    return [
      "效率要求：",
      "- 不要总结已经显而易见的内容",
      "- 只修改必要的代码行",
      "- 避免冗余的格式调整",
    ].join("\n");
  };
  ```

- [ ] **Step 2: 编写 dynamic sections（4 个）**

  `session-specific-guidance.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    // MVP 阶段占位，后续可注入会话级引导
    return "";
  };
  ```

  `memory.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async (context) => {
    if (!context.memoryFiles || context.memoryFiles.length === 0) {
      return "";
    }
    return ["记忆内容：", ...context.memoryFiles].join("\n");
  };
  ```

  `env-info.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async (context) => {
    return [
      `当前工作目录：${context.cwd}`,
      `当前模型：${context.model.id}`,
    ].join("\n");
  };
  ```

  `summarize-tool-results.ts`：
  ```typescript
  import type { SectionCompute } from "../types.js";

  export const compute: SectionCompute = async () => {
    return [
      "当 tool result 内容较长时，请对其进行简要总结，保留关键信息。",
    ].join("\n");
  };
  ```

- [ ] **Step 3: 验证类型检查通过**

  Run: `bun tsc --noEmit`
  Expected: PASS

- [ ] **Step 4: Commit**

  ```bash
  git add src/agent/system-prompt/sections/
  git commit -m "feat(system-prompt): add 11 section definitions (7 static + 4 dynamic)"
  ```

---

### Task 4: 创建 systemPrompt.ts 调度器

**Files:**
- Create: `src/agent/system-prompt/systemPrompt.ts`
- Test: `src/agent/system-prompt/systemPrompt.test.ts`

- [ ] **Step 1: 编写测试（TDD 第一步）**

  ```typescript
  // src/agent/system-prompt/systemPrompt.test.ts
  import { describe, it, expect } from "bun:test";
  import { createSystemPromptBuilder, type SystemPromptSection } from "./systemPrompt.js";
  import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./types.js";

  describe("createSystemPromptBuilder", () => {
    it("should return sections with boundary between static and dynamic", async () => {
      const sections: SystemPromptSection[] = [
        { name: "s1", compute: async () => "static1", getCacheKey: () => "k1" },
        { name: "d1", compute: async () => "dynamic1" },
      ];
      const builder = createSystemPromptBuilder(sections);
      const result = await builder({ cwd: "/tmp", tools: [], model: { id: "m1" } as any });
      expect(result).toEqual(["static1", SYSTEM_PROMPT_DYNAMIC_BOUNDARY, "dynamic1"]);
    });

    it("should cache static sections", async () => {
      let callCount = 0;
      const sections: SystemPromptSection[] = [
        {
          name: "s1",
          compute: async () => {
            callCount++;
            return "v1";
          },
          getCacheKey: () => "k1",
        },
      ];
      const builder = createSystemPromptBuilder(sections);
      const ctx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };
      await builder(ctx);
      await builder(ctx);
      expect(callCount).toBe(1);
    });

    it("should recompute dynamic sections every time", async () => {
      let callCount = 0;
      const sections: SystemPromptSection[] = [
        {
          name: "d1",
          compute: async () => {
            callCount++;
            return "v1";
          },
        },
      ];
      const builder = createSystemPromptBuilder(sections);
      const ctx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };
      await builder(ctx);
      await builder(ctx);
      expect(callCount).toBe(2);
    });

    it("should return empty string when section compute throws", async () => {
      const sections: SystemPromptSection[] = [
        { name: "bad", compute: async () => { throw new Error("fail"); }, getCacheKey: () => "k1" },
      ];
      const builder = createSystemPromptBuilder(sections);
      const ctx = { cwd: "/tmp", tools: [], model: { id: "m1" } as any };
      const result = await builder(ctx);
      expect(result).toEqual([""]);
    });
  });
  ```

- [ ] **Step 2: 运行测试，确认失败**

  Run: `bun test src/agent/system-prompt/systemPrompt.test.ts`
  Expected: FAIL（`createSystemPromptBuilder` 和 `./systemPrompt.js` 不存在）

- [ ] **Step 3: 实现 systemPrompt.ts**

  ```typescript
  // src/agent/system-prompt/systemPrompt.ts
  import type {
    SystemPromptContext,
    SystemPromptSection,
  } from "./types.js";
  import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "./types.js";

  /** 缓存条目 */
  interface CacheEntry {
    /** 缓存键 */
    cacheKey: string;
    /** 缓存值 */
    value: string;
  }

  /** 创建 system prompt 构建器 */
  export function createSystemPromptBuilder(
    sections: SystemPromptSection[],
  ): (context: SystemPromptContext) => Promise<string[]> {
    const cache = new Map<string, CacheEntry>();

    return async (context: SystemPromptContext): Promise<string[]> => {
      const staticValues: string[] = [];
      for (const section of sections) {
        if (!section.getCacheKey) continue;
        const cacheKey = section.getCacheKey(context);
        const hit = cache.get(section.name);
        if (hit && hit.cacheKey === cacheKey) {
          staticValues.push(hit.value);
          continue;
        }
        try {
          const value = await section.compute(context);
          cache.set(section.name, { cacheKey, value });
          staticValues.push(value);
        } catch (err) {
          console.warn(`[system-prompt] section "${section.name}" compute failed:`, err);
          staticValues.push("");
        }
      }

      const dynamicValues: string[] = [];
      for (const section of sections) {
        if (section.getCacheKey) continue;
        try {
          const value = await section.compute(context);
          dynamicValues.push(value);
        } catch (err) {
          console.warn(`[system-prompt] section "${section.name}" compute failed:`, err);
          dynamicValues.push("");
        }
      }

      return [...staticValues, SYSTEM_PROMPT_DYNAMIC_BOUNDARY, ...dynamicValues];
    };
  }

  export type { SystemPromptSection };
  ```

- [ ] **Step 4: 运行测试，确认通过**

  Run: `bun test src/agent/system-prompt/systemPrompt.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/agent/system-prompt/systemPrompt.ts src/agent/system-prompt/systemPrompt.test.ts
  git commit -m "feat(system-prompt): add builder with section-level caching"
  ```

---

### Task 5: Agent 层集成

**Files:**
- Modify: `src/agent/agent.ts`

- [ ] **Step 1: 扩展 AgentOptions 接口**

  在 `src/agent/agent.ts` 中（`AgentOptions` 接口），在 `convertToLlm` 字段附近新增：

  ```typescript
  export interface AgentOptions {
    // ... 现有字段
    /** 构建 system prompt 的函数 */
    buildSystemPrompt?: (context: AgentContext) => Promise<string[]>;
    // ...
  }
  ```

- [ ] **Step 2: 在 Agent 类中挂载 buildSystemPrompt**

  在 `Agent` 类的属性声明区（`convertToLlm` 附近）添加：

  ```typescript
  /** 构建 system prompt 的函数 */
  public buildSystemPrompt?: (context: AgentContext) => Promise<string[]>;
  ```

  在构造函数中赋值：

  ```typescript
  constructor(options: AgentOptions = {}) {
    // ... 现有初始化代码
    this.buildSystemPrompt = options.buildSystemPrompt;
    // ...
  }
  ```

- [ ] **Step 3: 将 createLoopConfig 改为 async**

  修改 `createLoopConfig` 的签名：

  ```typescript
  /** 创建循环配置 */
  private async createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): Promise<AgentLoopConfig> {
  ```

  在方法体中修改 `systemPrompt` 注入逻辑（替换原来的简单赋值）：

  ```typescript
  private async createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): Promise<AgentLoopConfig> {
    let skipInitialSteeringPoll = options.skipInitialSteeringPoll === true;
    return {
      model: this._state.model,
      reasoning: this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel,
      sessionId: this.sessionId,
      onPayload: this.onPayload,
      transport: this.transport,
      thinkingBudgets: this.thinkingBudgets,
      maxRetryDelayMs: this.maxRetryDelayMs,
      toolExecution: this.toolExecution,
      beforeToolCall: this.beforeToolCall,
      afterToolCall: this.afterToolCall,
      convertToLlm: this.convertToLlm,
      transformContext: this.transformContext,
      getApiKey: this.getApiKey,
      systemPrompt: this.buildSystemPrompt
        ? await this.buildSystemPrompt(this.createContextSnapshot())
        : this._state.systemPrompt,
      getSteeringMessages: async () => {
        if (skipInitialSteeringPoll) {
          skipInitialSteeringPoll = false;
          return [];
        }
        return this.steeringQueue.drain();
      },
      getFollowUpMessages: async () => this.followUpQueue.drain(),
    };
  }
  ```

- [ ] **Step 4: 在调用 createLoopConfig 的地方加 await**

  找到 `runPromptMessages` 和 `runContinuation` 中对 `createLoopConfig` 的调用：

  ```typescript
  private async runPromptMessages(...): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoop(
        messages,
        this.createContextSnapshot(),
        await this.createLoopConfig(options),  // 加 await
        (event) => this.processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }

  private async runContinuation(): Promise<void> {
    await this.runWithLifecycle(async (signal) => {
      await runAgentLoopContinue(
        this.createContextSnapshot(),
        await this.createLoopConfig(),  // 加 await
        (event) => this.processEvents(event),
        signal,
        this.streamFn,
      );
    });
  }
  ```

- [ ] **Step 5: 验证类型检查通过**

  Run: `bun tsc --noEmit`
  Expected: PASS

- [ ] **Step 6: Commit**

  ```bash
  git add src/agent/agent.ts
  git commit -m "feat(agent): integrate buildSystemPrompt with async createLoopConfig"
  ```

---

### Task 6: Anthropic Provider 适配

**Files:**
- Modify: `src/core/ai/providers/anthropic.ts`

- [ ] **Step 1: 添加 buildSystemBlocks 辅助函数**

  在 `anthropic.ts` 文件底部（`mapStopReason` 附近或上方）添加：

  ```typescript
  import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from "../../agent/system-prompt/types.js";

  function buildSystemBlocks(
    sections: string[],
    cacheControl?: { type: "ephemeral"; ttl?: "1h" },
  ): Anthropic.Messages.TextBlockParam[] {
    const boundaryIndex = sections.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY);
    const staticSections = boundaryIndex >= 0 ? sections.slice(0, boundaryIndex) : sections;
    const dynamicSections = boundaryIndex >= 0 ? sections.slice(boundaryIndex + 1) : [];

    const blocks: Anthropic.Messages.TextBlockParam[] = [];
    const staticText = staticSections.filter((s) => s.trim().length > 0).join("\n\n");
    const dynamicText = dynamicSections.filter((s) => s.trim().length > 0).join("\n\n");

    if (staticText) {
      blocks.push({
        type: "text",
        text: sanitizeSurrogates(staticText),
        ...(cacheControl ? { cache_control: cacheControl } : {}),
      });
    }
    if (dynamicText) {
      blocks.push({
        type: "text",
        text: sanitizeSurrogates(dynamicText),
      });
    }
    return blocks;
  }
  ```

  注意：`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 的导入路径可能需要根据实际编译后的结构调整为 `../../../agent/system-prompt/types.js`，请根据项目现有的相对路径约定确认。当前 anthropic.ts 在 `src/core/ai/providers/anthropic.ts`，而 types.ts 在 `src/agent/system-prompt/types.ts`，所以正确的相对路径是 `../../agent/system-prompt/types.js`（从 core/ai/providers 到 agent/system-prompt：../../agent）。

- [ ] **Step 2: 修改 buildParams 中的 systemPrompt 处理逻辑**

  找到 `buildParams` 函数中现有的 system prompt 处理：

  ```typescript
  if (context.systemPrompt) {
    params.system = [
      {
        type: "text",
        text: sanitizeSurrogates(context.systemPrompt),
        ...(cacheControl ? { cache_control: cacheControl } : {}),
      },
    ];
  }
  ```

  替换为：

  ```typescript
  if (context.systemPrompt) {
    if (Array.isArray(context.systemPrompt)) {
      params.system = buildSystemBlocks(context.systemPrompt, cacheControl);
    } else {
      params.system = [
        {
          type: "text",
          text: sanitizeSurrogates(context.systemPrompt),
          ...(cacheControl ? { cache_control: cacheControl } : {}),
        },
      ];
    }
  }
  ```

- [ ] **Step 3: 验证类型检查通过**

  Run: `bun tsc --noEmit`
  Expected: PASS

- [ ] **Step 4: Commit**

  ```bash
  git add src/core/ai/providers/anthropic.ts
  git commit -m "feat(anthropic): support string[] systemPrompt with boundary-based cache control"
  ```

---

### Task 7: 端到端验证

**Files:**
- 无新增文件，只运行验证

- [ ] **Step 1: 运行所有现有测试**

  Run: `bun test`
  Expected: ALL PASS（确保改动没有破坏现有 agent-loop、stream-assistant、tool-execution 测试）

- [ ] **Step 2: 运行类型检查**

  Run: `bun tsc --noEmit`
  Expected: PASS

- [ ] **Step 3: Commit（如测试全部通过）**

  ```bash
  git commit --allow-empty -m "test: verify system-prompt changes pass all tests"
  ```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - 11 sections（7 static + 4 dynamic）→ Task 3
  - `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` → Task 2
  - section-level caching → Task 4
  - Agent 集成 `buildSystemPrompt` → Task 5
  - `string | string[]` 类型扩展 → Task 1
  - Anthropic provider cache_control 分配 → Task 6
  - 空字符串占位和 provider 层过滤 → Task 3（section 返回空字符串）、Task 6（`buildSystemBlocks` filter）
  - 异常降级 → Task 4（try/catch 返回 `""`）

- [x] **Placeholder scan:** 所有步骤均包含具体代码、具体命令、具体预期输出，无 "TBD"、"TODO"、"similar to Task N"。

- [x] **Type consistency:**
  - `SystemPromptContext` 在 Task 2 定义，Task 3 sections 和 Task 4 builder 中保持一致使用
  - `string | string[]` 在 Task 1 扩展，Task 5 和 Task 6 中消费
  - `createLoopConfig` 的 `async` 变更在 Task 5 中同时修改了签名和两处调用点
