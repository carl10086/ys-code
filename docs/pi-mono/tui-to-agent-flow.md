# pi-mono Coding Agent：TUI → Agent 数据流分析

## 1. 整体架构

pi-mono 的 coding-agent 采用 **单向事件流** 架构：

```
用户（终端键盘）
     │
     ▼
TUI 层（pi-tui 组件）
     │
     ├── 用户输入（Enter）
     ├── 本地命令拦截（/model, /new, /tree）
     └── 非本地命令 → AgentSession
              │
              ▼
     AgentSession（业务逻辑层）
              │
              ├── 扩展命令处理
              ├── Prompt 模板展开
              ├── 模型/Auth 验证
              └── Agent.prompt() / steer() / followUp()
                       │
                       ▼
              Agent（底层运行时）
                       │
                       ├── AgentLoop
                       ├── streamSimple() → LLM
                       └── 事件流回调
                                │
                                ▼
              AgentSession.subscribe()
                                │
                                ▼
              InteractiveMode.handleEvent()
                                │
                                ▼
              TUI 组件更新（chatContainer.addChild）
```

## 2. 核心对象关系

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         InteractiveMode                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  runtimeHost: AgentSessionRuntime                                    │   │
│  │     ├── session: AgentSession                                       │   │
│  │     │     ├── agent: Agent                                          │   │
│  │     │     │     └── agent-loop                                      │   │
│  │     │     ├── sessionManager: SessionManager                        │   │
│  │     │     ├── settingsManager: SettingsManager                      │   │
│  │     │     └── modelRegistry: ModelRegistry                          │   │
│  │     └── services: AgentSessionServices                              │   │
│  │                                                                      │   │
│  │  ui: TUI                          ← pi-tui                          │   │
│  │  chatContainer: Container         ← 消息列表容器                     │   │
│  │  editor: CustomEditor             ← 输入框                          │   │
│  │  footer: FooterComponent          ← 底部状态栏                      │   │
│  │                                                                      │   │
│  │  unsubscribe?: () => void          ← AgentSession 事件订阅          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. 输入流：TUI → AgentSession

### 3.1 用户输入捕获

```typescript
// InteractiveMode.setupEditorSubmitHandler()
this.defaultEditor.onSubmit = async (text: string) => {
    text = text.trim();
    if (!text) return;

    // 1. 本地命令拦截（直接在 TUI 层处理）
    if (text === "/settings") { this.showSettingsSelector(); return; }
    if (text === "/model") { await this.handleModelCommand(...); return; }
    if (text === "/new") { await this.handleClearCommand(); return; }
    if (text === "/tree") { this.showTreeSelector(); return; }
    // ... 更多本地命令

    // 2. Bash 模式（!command）
    if (text.startsWith("!")) {
        await this.handleBashCommand(command);
        return;
    }

    // 3. 正常消息提交
    if (this.session.isStreaming) {
        // Agent 正在运行时，使用 steer（中断式）
        await this.session.prompt(text, { streamingBehavior: "steer" });
    } else {
        await this.session.prompt(text);
    }
};
```

### 3.2 AgentSession.prompt() 内部流程

```typescript
async prompt(text: string, options?: PromptOptions): Promise<void> {
    // 1. 扩展命令拦截（立即执行，不进入 LLM）
    if (expandPromptTemplates && text.startsWith("/")) {
        const handled = await this._tryExecuteExtensionCommand(text);
        if (handled) return;  // 扩展命令自己处理 LLM 交互
    }

    // 2. 扩展输入拦截
    if (this._extensionRunner?.hasHandlers("input")) {
        const inputResult = await this._extensionRunner.emitInput(currentText, ...);
        if (inputResult.action === "handled") return;
        if (inputResult.action === "transform") {
            currentText = inputResult.text;
        }
    }

    // 3. 展开 skill 命令和 prompt 模板
    expandedText = this._expandSkillCommand(expandedText);
    expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);

    // 4. 如果在 streaming，转交给队列
    if (this.isStreaming) {
        if (options?.streamingBehavior === "followUp") {
            await this._queueFollowUp(expandedText, currentImages);
        } else {
            await this._queueSteer(expandedText, currentImages);
        }
        return;
    }

    // 5. 模型验证
    if (!this.model) throw new Error("No model selected");
    if (!this._modelRegistry.hasConfiguredAuth(this.model)) {
        throw new Error("No API key...");
    }

    // 6. 构建用户消息
    const messages: AgentMessage[] = [];
    messages.push({
        role: "user",
        content: [{ type: "text", text: expandedText }, ...images],
        timestamp: Date.now(),
    });

    // 7. 触发 before_agent_start 扩展事件
    if (this._extensionRunner) {
        const result = await this._extensionRunner.emitBeforeAgentStart(...);
        if (result?.messages) messages.push(...result.messages);
        if (result?.systemPrompt) this.agent.state.systemPrompt = result.systemPrompt;
    }

    // 8. 调用底层 Agent
    await this.agent.prompt(messages);
    await this.waitForRetry();  // 等待自动重试完成
}
```

### 3.3 Agent 启动循环

```typescript
// Agent.prompt() → Agent.runWithLifecycle()
private async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const abortController = new AbortController();
    this.activeRun = { promise, resolve: resolvePromise, abortController };
    this._state.isStreaming = true;

    try {
        await executor(abortController.signal);
    } catch (error) {
        await this.handleRunFailure(error, abortController.signal.aborted);
    } finally {
        this.finishRun();
    }
}
```

### 3.4 AgentLoop 执行

```typescript
// runAgentLoop() 核心流程
async function runAgentLoop(prompts, context, config, emit, signal, streamFn) {
    await emit({ type: "agent_start" });
    await emit({ type: "turn_start" });

    // 发送用户消息事件
    for (const prompt of prompts) {
        await emit({ type: "message_start", message: prompt });
        await emit({ type: "message_end", message: prompt });
    }

    // 循环处理 steering 消息和 tool calls
    while (true) {
        // 1. 流式获取 LLM 响应
        const message = await streamAssistantResponse(context, config, signal, emit, streamFn);

        // 2. 检查 tool calls
        const toolCalls = message.content.filter(c => c.type === "toolCall");
        if (toolCalls.length > 0) {
            const toolResults = await executeToolCalls(context, message, config, signal, emit);
            // toolResults 被加入 context.messages
        }

        await emit({ type: "turn_end", message, toolResults });

        // 3. 检查 steering 消息
        const steeringMessages = await config.getSteeringMessages?.();
        if (steeringMessages.length > 0) {
            // 注入 steering 消息，继续循环
            for (const msg of steeringMessages) {
                await emit({ type: "message_start", message: msg });
                await emit({ type: "message_end", message: msg });
                context.messages.push(msg);
            }
            continue;
        }

        // 4. 检查 follow-up 消息
        const followUpMessages = await config.getFollowUpMessages?.();
        if (followUpMessages.length > 0) {
            // 注入 follow-up 消息，继续循环
            pendingMessages = followUpMessages;
            continue;
        }

        break;
    }

    await emit({ type: "agent_end", messages: newMessages });
}
```

## 4. 输出流：Agent → TUI

### 4.1 事件订阅建立

```typescript
// InteractiveMode.subscribeToAgent()
private subscribeToAgent(): void {
    this.unsubscribe = this.session.subscribe(async (event) => {
        await this.handleEvent(event);
    });
}
```

### 4.2 事件处理映射

```typescript
private async handleEvent(event: AgentSessionEvent): Promise<void> {
    switch (event.type) {
        // ========== Agent 生命周期 ==========
        case "agent_start":
            // 显示 loading 动画
            this.loadingAnimation = new Loader(...);
            this.statusContainer.addChild(this.loadingAnimation);
            break;

        case "agent_end":
            // 停止 loading
            this.loadingAnimation?.stop();
            // 清理 pending tools
            this.flushPendingBashComponents();
            break;

        // ========== 队列更新 ==========
        case "queue_update":
            // 更新 steering/followUp 队列显示
            this.updatePendingMessagesDisplay();
            break;

        // ========== 消息生命周期 ==========
        case "message_start":
            if (event.message.role === "user") {
                this.addMessageToChat(event.message);
            } else if (event.message.role === "assistant") {
                // 创建流式消息组件
                this.streamingComponent = new AssistantMessageComponent(...);
                this.chatContainer.addChild(this.streamingComponent);
                this.streamingComponent.updateContent(event.message);
            }
            break;

        case "message_update":
            if (this.streamingComponent && event.message.role === "assistant") {
                this.streamingMessage = event.message;
                this.streamingComponent.updateContent(this.streamingMessage);

                // 检测 toolCall 并创建 ToolExecutionComponent
                for (const content of this.streamingMessage.content) {
                    if (content.type === "toolCall") {
                        if (!this.pendingTools.has(content.id)) {
                            const component = new ToolExecutionComponent(
                                content.name, content.id, content.arguments, ...
                            );
                            this.chatContainer.addChild(component);
                            this.pendingTools.set(content.id, component);
                        } else {
                            this.pendingTools.get(content.id)?.updateArgs(content.arguments);
                        }
                    }
                }
            }
            break;

        case "message_end":
            if (event.message.role === "assistant") {
                this.streamingMessage = event.message;
                this.streamingComponent?.updateContent(this.streamingMessage);

                if (event.message.stopReason === "aborted" || event.message.stopReason === "error") {
                    // 标记所有 pending tools 为错误
                    for (const [, component] of this.pendingTools.entries()) {
                        component.updateResult({ content: [{ type: "text", text: errorMessage }], isError: true });
                    }
                    this.pendingTools.clear();
                } else {
                    // 标记 args 完成（触发 diff 计算）
                    for (const [, component] of this.pendingTools.entries()) {
                        component.setArgsComplete();
                    }
                }

                this.streamingComponent = undefined;
                this.streamingMessage = undefined;
            }
            break;

        // ========== 工具执行生命周期 ==========
        case "tool_execution_start": {
            let component = this.pendingTools.get(event.toolCallId);
            if (!component) {
                component = new ToolExecutionComponent(event.toolName, event.toolCallId, event.args, ...);
                this.chatContainer.addChild(component);
                this.pendingTools.set(event.toolCallId, component);
            }
            component.markExecutionStarted();
            break;
        }

        case "tool_execution_update": {
            const component = this.pendingTools.get(event.toolCallId);
            if (component) {
                component.updateResult({ ...event.partialResult, isError: false }, true);
            }
            break;
        }

        case "tool_execution_end": {
            const component = this.pendingTools.get(event.toolCallId);
            if (component) {
                component.updateResult({ ...event.result, isError: event.isError });
                this.pendingTools.delete(event.toolCallId);
            }
            break;
        }
    }

    // 每次事件后请求重绘
    this.ui.requestRender();
}
```

## 5. 关键设计模式

### 5.1 订阅者模式（单向数据流）

TUI 不直接访问 Agent 内部状态，而是通过 **事件订阅** 接收所有更新：

```
AgentLoop (emitter)
    │ emit(event)
    ▼
Agent.processEvents(event)
    │ 更新内部 _state
    │ 调用 listeners
    ▼
InteractiveMode.handleEvent(event)
    │ 将事件映射为 TUI 组件操作
    ▼
TUI (pi-tui) requestRender()
```

### 5.2 Steering / FollowUp 队列

当 Agent 正在 streaming 时，用户可以继续输入：

```
用户输入 → session.prompt(text, { streamingBehavior: "steer" })
                    │
                    ├── "steer": 插入到 steeringQueue
                    │            当前 assistant turn 结束后立即注入
                    │
                    └── "followUp": 插入到 followUpQueue
                                 当 Agent 完全空闲后才注入
```

### 5.3 本地命令与远程命令分离

**本地命令**（TUI 层直接处理）：
- `/model` - 切换模型
- `/new` - 新建会话
- `/tree` - 树导航
- `/settings` - 设置选择器

**远程命令**（传给 AgentSession 处理）：
- `/skill:name` - 展开 skill prompt
- `/template` - 展开 prompt 模板
- 扩展注册的自定义命令

## 6. 流式消息渲染

Assistant 消息使用 **增量更新** 方式渲染：

```
message_start
    │
    ├── 创建 AssistantMessageComponent（空内容）
    │
message_update (text_delta)
    │
    ├── streamingComponent.updateContent(partialMessage)
    │
message_update (toolcall_start)
    │
    ├── 创建 ToolExecutionComponent
    │
message_update (toolcall_delta)
    │
    ├── 更新 tool arguments JSON
    │
message_end
    │
    ├── 最终 updateContent
    ├── 如果是 aborted/error → 标记错误
    └── streamingComponent = undefined（完成流式接收）
```

## 7. Session 生命周期管理

`AgentSessionRuntime` 负责 Session 的替换和清理：

```typescript
class AgentSessionRuntime {
    get session(): AgentSession { ... }

    async switchSession(sessionPath: string): Promise<void> {
        await this.teardownCurrent();
        const result = await this.createRuntime({ sessionManager: newSessionManager });
        this.apply(result);
    }

    async newSession(): Promise<void> {
        await this.teardownCurrent();
        // ... 创建新 session
    }

    async fork(entryId: string): Promise<void> {
        await this.teardownCurrent();
        // ... 创建分支 session
    }

    private async teardownCurrent(): Promise<void> {
        await emitSessionShutdownEvent(this.session.extensionRunner);
        this.session.dispose();
    }
}
```

**InteractiveMode 的响应**：当 `AgentSessionRuntime` 切换 session 后，需要重新订阅：

```typescript
// InteractiveMode 中
private get session(): AgentSession {
    return this.runtimeHost.session;
}

// session 切换后，重新建立订阅
this.unsubscribe?.();
this.unsubscribe = undefined;
this.subscribeToAgent();
```

## 8. 总结

pi-mono 的 **TUI → Agent** 数据流核心特点：

1. **严格分层**：TUI（InteractiveMode）只负责渲染和输入捕获，业务逻辑在 AgentSession
2. **单向事件流**：TUI 通过 `subscribe()` 接收 Agent 事件，不反向操作 Agent 内部状态
3. **队列机制**：`steer` / `followUp` 支持在 Agent 运行时安全地添加后续消息
4. **本地命令拦截**：常见命令在 TUI 层直接处理，避免不必要的 LLM 调用
5. **增量渲染**：Assistant 消息和 tool call 参数通过 `message_update` 事件增量更新到 TUI
