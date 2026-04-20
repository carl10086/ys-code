// src/agent/tool-execution.ts
import { type AssistantMessage, type ToolResultMessage, validateToolArguments } from "../core/ai/index.js";
import type { AgentEventSink } from "./stream-assistant.js";
import { logger } from "../utils/logger.js";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  ToolUseContext,
} from "./types.js";

function createErrorToolResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: "text", text: message }],
    details: {},
  };
}

function buildToolUseContext(
  currentContext: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): ToolUseContext {
  return {
    abortSignal: signal ?? new AbortController().signal,
    messages: currentContext.messages,
    tools: currentContext.tools ?? [],
    sessionId: (config as any).sessionId,
    model: config.model,
  };
}

async function emitToolCallOutcome(
  toolCall: import("../core/ai/index.js").ToolCall,
  result: AgentToolResult<any>,
  isError: boolean,
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  await emit({
    type: "tool_execution_end",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    result,
    isError,
  });

  const toolResultMessage: ToolResultMessage = {
    role: "toolResult",
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: result.content,
    details: result.details,
    isError,
    timestamp: Date.now(),
  };

  await emit({ type: "message_start", message: toolResultMessage });
  await emit({ type: "message_end", message: toolResultMessage });
  return toolResultMessage;
}

async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: import("../core/ai/index.js").ToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<
  | { kind: "prepared"; toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any, any>; args: unknown }
  | { kind: "immediate"; result: AgentToolResult<any>; isError: boolean }
> {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }

  try {
    const validatedArgs = tool.prepareArguments
      ? tool.prepareArguments(toolCall.arguments)
      : validateToolArguments(tool as any, toolCall);

    const context = buildToolUseContext(currentContext, config, signal);

    if (tool.validateInput) {
      const validation = await tool.validateInput(validatedArgs, context);
      if (!validation.ok) {
        return {
          kind: "immediate",
          result: createErrorToolResult(validation.message),
          isError: true,
        };
      }
    }

    if (tool.checkPermissions) {
      const permission = await tool.checkPermissions(validatedArgs, context);
      if (!permission.allowed) {
        return {
          kind: "immediate",
          result: createErrorToolResult(permission.reason),
          isError: true,
        };
      }
    }

    return {
      kind: "prepared",
      toolCall,
      tool,
      args: validatedArgs,
    };
  } catch (error) {
    return {
      kind: "immediate",
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}

async function executePreparedToolCall(
  prepared: { toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any, any>; args: unknown },
  currentContext: AgentContext,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ output: unknown; isError: boolean; newMessages?: AgentMessage[]; contextModifier?: (messages: AgentMessage[]) => AgentMessage[] }> {
  const updateEvents: Promise<void>[] = [];
  const context = buildToolUseContext(currentContext, config, signal);

  try {
    const output = await prepared.tool.execute(
      prepared.toolCall.id,
      prepared.args as never,
      context,
      (partialOutput) => {
        updateEvents.push(
          Promise.resolve(
            emit({
              type: "tool_execution_update",
              toolCallId: prepared.toolCall.id,
              toolName: prepared.toolCall.name,
              args: prepared.toolCall.arguments,
              partialResult: partialOutput,
            }),
          ),
        );
      },
    );
    await Promise.all(updateEvents);
    // 提取 newMessages 和 contextModifier
    const toolResult = output as AgentToolResult<unknown>;
    const newMessages = toolResult?.newMessages;
    const contextModifier = toolResult?.contextModifier;
    return { output, isError: false, newMessages, contextModifier };
  } catch (error) {
    await Promise.all(updateEvents);
    return {
      output: error instanceof Error ? error.message : String(error),
      isError: true,
    };
  }
}

async function finalizeExecutedToolCall(
  prepared: { toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any, any>; args: unknown },
  executed: { output: unknown; isError: boolean },
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  let content: (import("../core/ai/index.js").TextContent | import("../core/ai/index.js").ImageContent)[];
  let details: unknown;

  if (executed.isError) {
    content = [{ type: "text", text: String(executed.output) }];
    details = {};
  } else {
    details = executed.output;
    if (prepared.tool.formatResult) {
      const formatted = prepared.tool.formatResult(executed.output, prepared.toolCall.id);
      content = typeof formatted === "string" ? [{ type: "text", text: formatted }] : formatted;
    } else {
      content = [{ type: "text", text: String(executed.output) }];
    }
  }

  const result: AgentToolResult<any> = { content, details };
  return await emitToolCallOutcome(prepared.toolCall, result, executed.isError, emit);
}

async function executeToolCallsSequential(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: import("../core/ai/index.js").ToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];

  for (const toolCall of toolCalls) {
    logger.debug("Tool execution started (sequential)", { toolName: toolCall.name, args: toolCall.arguments });
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
    if (preparation.kind === "immediate") {
      results.push(await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit));
    } else {
      const executed = await executePreparedToolCall(preparation, currentContext, config, signal, emit);
      // 注入 newMessages 到 messages 列表
      if (executed.newMessages && executed.newMessages.length > 0) {
        for (const msg of executed.newMessages) {
          currentContext.messages.push(msg);
        }
        logger.debug("Injected newMessages from tool", { count: executed.newMessages.length });
      }
      // 执行 contextModifier 修改消息上下文
      if (executed.contextModifier) {
        currentContext.messages = executed.contextModifier(currentContext.messages);
        logger.debug("Applied contextModifier from tool");
      }
      logger.debug("Tool execution result (sequential)", { toolName: toolCall.name, output: executed.output, isError: executed.isError });
      results.push(await finalizeExecutedToolCall(preparation, executed, emit));
    }
  }

  return results;
}

async function executeToolCallsParallel(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCalls: import("../core/ai/index.js").ToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const results: ToolResultMessage[] = [];
  const runnableCalls: Array<{ toolCall: import("../core/ai/index.js").ToolCall; tool: AgentTool<any, any>; args: unknown }> = [];

  for (const toolCall of toolCalls) {
    logger.debug("Tool execution started (parallel)", { toolName: toolCall.name, args: toolCall.arguments });
    await emit({
      type: "tool_execution_start",
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      args: toolCall.arguments,
    });

    const preparation = await prepareToolCall(currentContext, assistantMessage, toolCall, config, signal);
    if (preparation.kind === "immediate") {
      results.push(await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit));
    } else {
      runnableCalls.push(preparation);
    }
  }

  const runningCalls = runnableCalls.map((prepared) => ({
    prepared,
    execution: executePreparedToolCall(prepared, currentContext, config, signal, emit),
  }));

  const executedResults = await Promise.all(runningCalls.map((r) => r.execution));

  for (let i = 0; i < executedResults.length; i++) {
    const executed = executedResults[i];
    const prepared = runningCalls[i].prepared;
    // 注入 newMessages 到 messages 列表
    if (executed.newMessages && executed.newMessages.length > 0) {
      for (const msg of executed.newMessages) {
        currentContext.messages.push(msg);
      }
      logger.debug("Injected newMessages from tool (parallel)", { count: executed.newMessages.length });
    }
    // 执行 contextModifier 修改消息上下文
    if (executed.contextModifier) {
      currentContext.messages = executed.contextModifier(currentContext.messages);
      logger.debug("Applied contextModifier from tool (parallel)");
    }
    logger.debug("Tool execution result (parallel)", { toolName: prepared.toolCall.name, output: executed.output, isError: executed.isError });
    const finalResult = await finalizeExecutedToolCall(prepared, executed, emit);
    results.push(finalResult);
  }

  return results;
}

export async function executeToolCalls(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<ToolResultMessage[]> {
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall") as import("../core/ai/index.js").ToolCall[];
  if (config.toolExecution === "sequential") {
    return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
  }
  return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}
