// src/agent/tool-execution.ts
import { type AssistantMessage, type ToolResultMessage, validateToolArguments } from "../core/ai/index.js";
import type { AgentEventSink } from "./stream-assistant.js";
import { logger } from "../utils/logger.js";
import type {
  AgentRuntime,
  AgentLoopConfig,
  AgentMessage,
  AgentTool,
  AgentToolResult,
  ToolRenderResult,
  ToolUseContext,
} from "./types.js";

function createErrorToolResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: "text", text: message }],
    details: {},
  };
}

function buildToolUseContext(
  currentContext: AgentRuntime,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): ToolUseContext {
  return {
    abortSignal: signal ?? new AbortController().signal,
    messages: currentContext.messages,
    tools: currentContext.tools ?? [],
    sessionId: (config as any).sessionId,
    model: config.model,
    fileStateCache: config.fileStateCache,
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
  currentContext: AgentRuntime,
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
  currentContext: AgentRuntime,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ output: unknown; isError: boolean; newMessages?: AgentMessage[] }> {
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
    // 提取 newMessages
    const toolResult = output as AgentToolResult<unknown>;
    const newMessages = toolResult?.newMessages;
    return { output, isError: false, newMessages };
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
  executed: { output: unknown; isError: boolean; newMessages?: AgentMessage[] },
  emit: AgentEventSink,
): Promise<ToolResultMessage> {
  let content: (import("../core/ai/index.js").TextContent | import("../core/ai/index.js").ImageContent)[];
  let details: unknown;
  let renderData: ToolRenderResult | undefined;

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
    if (prepared.tool.renderResult) {
      try {
        const rendered = prepared.tool.renderResult(executed.output, prepared.toolCall.id);
        if (rendered) {
          renderData = rendered;
        }
      } catch (error) {
        logger.warn("Tool renderResult failed, falling back to plain text", {
          toolName: prepared.tool.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const result: AgentToolResult<any> = { content, details, renderData };
  return await emitToolCallOutcome(prepared.toolCall, result, executed.isError, emit);
}

async function executeToolCallsSequential(
  currentContext: AgentRuntime,
  assistantMessage: AssistantMessage,
  toolCalls: import("../core/ai/index.js").ToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ toolResults: ToolResultMessage[]; newMessages: AgentMessage[] }> {
  const toolResults: ToolResultMessage[] = [];
  const newMessages: AgentMessage[] = [];

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
      toolResults.push(await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit));
    } else {
      const executed = await executePreparedToolCall(preparation, currentContext, config, signal, emit);
      if (executed.newMessages && executed.newMessages.length > 0) {
        newMessages.push(...executed.newMessages);
        logger.debug("Tool newMessages collected (sequential)", { count: executed.newMessages.length });
      }
      logger.debug("Tool execution result (sequential)", { toolName: toolCall.name, output: executed.output, isError: executed.isError });
      toolResults.push(await finalizeExecutedToolCall(preparation, executed, emit));
    }
  }

  return { toolResults, newMessages };
}

async function executeToolCallsParallel(
  currentContext: AgentRuntime,
  assistantMessage: AssistantMessage,
  toolCalls: import("../core/ai/index.js").ToolCall[],
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ toolResults: ToolResultMessage[]; newMessages: AgentMessage[] }> {
  const toolResults: ToolResultMessage[] = [];
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
      toolResults.push(await emitToolCallOutcome(toolCall, preparation.result, preparation.isError, emit));
    } else {
      runnableCalls.push(preparation);
    }
  }

  const runningCalls = runnableCalls.map((prepared) => ({
    prepared,
    execution: executePreparedToolCall(prepared, currentContext, config, signal, emit),
  }));

  const executedResults = await Promise.all(runningCalls.map((r) => r.execution));
  const newMessages: AgentMessage[] = [];

  for (let i = 0; i < executedResults.length; i++) {
    const executed = executedResults[i];
    const prepared = runningCalls[i].prepared;
    if (executed.newMessages && executed.newMessages.length > 0) {
      newMessages.push(...executed.newMessages);
      logger.debug("Tool newMessages collected (parallel)", { count: executed.newMessages.length });
    }
    logger.debug("Tool execution result (parallel)", { toolName: prepared.toolCall.name, output: executed.output, isError: executed.isError });
    const finalResult = await finalizeExecutedToolCall(prepared, executed, emit);
    toolResults.push(finalResult);
  }

  return { toolResults, newMessages };
}

export async function executeToolCalls(
  currentContext: AgentRuntime,
  assistantMessage: AssistantMessage,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
  emit: AgentEventSink,
): Promise<{ toolResults: ToolResultMessage[]; newMessages: AgentMessage[] }> {
  const toolCalls = assistantMessage.content.filter((c) => c.type === "toolCall") as import("../core/ai/index.js").ToolCall[];
  if (config.toolExecution === "sequential") {
    return executeToolCallsSequential(currentContext, assistantMessage, toolCalls, config, signal, emit);
  }
  return executeToolCallsParallel(currentContext, assistantMessage, toolCalls, config, signal, emit);
}
