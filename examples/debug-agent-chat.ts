import {Agent} from "../src/agent/agent.js";
import {getModel, getEnvApiKey} from "../src/core/ai/index.js";
import {createReadTool, createWriteTool, createEditTool, createBashTool} from "../src/agent/tools/index.js";
import {
    formatAICardEnd,
    formatAICardStart,
    formatAnswerPrefix,
    formatTextDelta,
    formatThinkingDelta,
    formatThinkingPrefix,
    formatToolEnd,
    formatToolStart,
    formatToolsPrefix,
    formatUserMessage,
} from "../src/cli/format.js";
import type {AgentEvent} from "../src/agent/types.js";

const model = getModel("minimax-cn", "MiniMax-M2.7-highspeed");
const apiKey = getEnvApiKey(model.provider) || process.env.MINIMAX_API_KEY;

const agent = new Agent({
    initialState: {
        systemPrompt: "你是一个乐于助人的助手。",
        model,
        thinkingLevel: "medium",
        tools: [
            createReadTool(process.cwd()),
            createWriteTool(process.cwd()),
            createEditTool(process.cwd()),
            createBashTool(process.cwd()),
        ],
    },
    getApiKey: () => apiKey,
});

/** 单次 turn 的格式化器，封装状态管理与输出逻辑 */
class TurnFormatter {
    /** turn 开始时间戳 */
    private turnStartTime = 0;
    /** 工具调用开始时间映射 */
    private toolStartTimes = new Map<string, number>();
    /** 当前 turn 内是否已输出 Thinking 标签 */
    private hasEmittedThinking = false;
    /** 当前 turn 内是否已输出 Answer 标签 */
    private hasEmittedAnswer = false;
    /** 当前 turn 内是否已输出 Tools 标签 */
    private hasEmittedTools = false;

    /** 重置 turn 级状态 */
    private resetTurn() {
        this.turnStartTime = Date.now();
        this.hasEmittedThinking = false;
        this.hasEmittedAnswer = false;
        this.hasEmittedTools = false;
        this.toolStartTimes.clear();
    }

    /** 处理 turn_start 事件 */
    onTurnStart(modelName: string) {
        this.resetTurn();
        process.stdout.write(formatAICardStart(modelName));
    }

    /** 处理 message_update 事件 */
    onMessageUpdate(ae: Extract<AgentEvent, { type: "message_update" }>["assistantMessageEvent"]) {
        if (ae.type === "thinking_delta") {
            if (!this.hasEmittedThinking) {
                this.hasEmittedThinking = true;
                process.stdout.write(formatThinkingPrefix());
            }
            process.stdout.write(formatThinkingDelta(ae.delta));
        } else if (ae.type === "text_delta") {
            if (!this.hasEmittedAnswer) {
                this.hasEmittedAnswer = true;
                process.stdout.write(formatAnswerPrefix());
            }
            process.stdout.write(formatTextDelta(ae.delta));
        }
    }

    /** 处理 tool_execution_start 事件 */
    onToolStart(toolCallId: string, toolName: string, args: unknown) {
        this.toolStartTimes.set(toolCallId, Date.now());
        if (!this.hasEmittedTools) {
            this.hasEmittedTools = true;
            process.stdout.write(formatToolsPrefix());
        }
        process.stdout.write(formatToolStart(toolName, args));
    }

    /** 处理 tool_execution_end 事件 */
    onToolEnd(toolCallId: string, toolName: string, isError: boolean, result: unknown) {
        const startTime = this.toolStartTimes.get(toolCallId) ?? Date.now();
        this.toolStartTimes.delete(toolCallId);
        const summary = isError
            ? String((result as any)?.content?.[0]?.text ?? "error")
            : String((result as any)?.content?.[0]?.text ?? "");
        const elapsed = Date.now() - startTime;
        process.stdout.write(formatToolEnd(toolName, isError, summary || "done", elapsed));
    }

    /** 处理 turn_end 事件 */
    onTurnEnd(message: Extract<AgentEvent, { type: "turn_end" }>["message"]) {
        const elapsed = Date.now() - this.turnStartTime;
        if (message.role === "assistant") {
            const usage = message.usage;
            process.stdout.write(formatAICardEnd(usage.totalTokens, usage.cost.total, elapsed));
        } else {
            process.stdout.write(formatAICardEnd(0, 0, elapsed));
        }
    }
}

const formatter = new TurnFormatter();

agent.subscribe((event) => {
    switch (event.type) {
        case "turn_start":
            formatter.onTurnStart(agent.state.model.name);
            break;
        case "message_update":
            formatter.onMessageUpdate(event.assistantMessageEvent);
            break;
        case "tool_execution_start":
            formatter.onToolStart(event.toolCallId, event.toolName, event.args);
            break;
        case "tool_execution_end":
            formatter.onToolEnd(event.toolCallId, event.toolName, event.isError, event.result);
            break;
        case "turn_end":
            formatter.onTurnEnd(event.message);
            break;
    }
});

async function main() {
    const inputs = [
        "写一个 200字的作文， 关于春天",
        "请用 bash 工具执行 `date`，然后告诉我现在几点。",
        "请告诉我当前目录是什么"
    ];

    const messages = inputs.map((text) => ({role: "user" as const, content: text, timestamp: Date.now()}));

    for (const text of inputs) {
        process.stdout.write(formatUserMessage(text));
    }

    try {
        await agent.prompt(messages);
    } catch (err) {
        console.error(`Error: ${err}`);
        process.exit(1);
    }

    console.log("\n[DEBUG] agent idle, messages count:", agent.state.messages.length);
    process.exit(0);
}

main();
