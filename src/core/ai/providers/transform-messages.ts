import type { Api, AssistantMessage, Message, Model, ToolCall, ToolResultMessage } from "../types.js";
import { ROLE } from "../types.js";

/**
 * 工具调用 ID 映射表，用于跨模型对话时标准化 toolCallId
 */
type ToolCallIdMap = Map<string, string>;

/**
 * 创建缺失的 toolResult 消息
 */
function createMissingToolResult(toolCall: ToolCall): ToolResultMessage {
	return {
		role: ROLE.TOOL_RESULT,
		toolCallId: toolCall.id,
		toolName: toolCall.name,
		content: [{ type: "text", text: "No result provided" }],
		isError: true,
		timestamp: Date.now(),
	};
}

/**
 * 填充孤立 toolCall 的 toolResult
 *
 * @param messages 转换后的消息列表
 * @returns 添加了缺失 toolResult 的新消息列表
 */
function fillOrphanToolResults(messages: Message[]): Message[] {
	const result: Message[] = [];
	/** 待处理的 toolCall 队列 */
	let pendingToolCalls: ToolCall[] = [];
	/** 已出现的 toolResult ID 集合 */
	let existingToolResultIds = new Set<string>();

	for (const msg of messages) {
		if (msg.role === ROLE.ASSISTANT) {
			// 遇到新的 assistant，先把之前的孤立 toolCall 填充完
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push(createMissingToolResult(tc));
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}

			const assistantMsg = msg as AssistantMessage;

			// 错误响应不处理 toolCall
			if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
				continue;
			}

			const toolCalls = assistantMsg.content.filter((b) => b.type === "toolCall") as ToolCall[];
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = new Set();
			}
			result.push(msg);
		} else if (msg.role === ROLE.TOOL_RESULT) {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
		} else if (msg.role === ROLE.USER) {
			// user 消息前也要填充孤立 toolCall
			if (pendingToolCalls.length > 0) {
				for (const tc of pendingToolCalls) {
					if (!existingToolResultIds.has(tc.id)) {
						result.push(createMissingToolResult(tc));
					}
				}
				pendingToolCalls = [];
				existingToolResultIds = new Set();
			}
			result.push(msg);
		} else {
			result.push(msg);
		}
	}

	// 末尾孤立 toolCall 填充
	if (pendingToolCalls.length > 0) {
		for (const tc of pendingToolCalls) {
			if (!existingToolResultIds.has(tc.id)) {
				result.push(createMissingToolResult(tc));
			}
		}
	}

	return result;
}

/**
 * 转换单条 assistant 消息的内容
 *
 * - thinking 块：同模型保留原始块，跨模型转为 text
 * - text 块：直接传递
 * - toolCall 块：移除跨模型的 thoughtSignature，标准化 ID
 */
function transformAssistantContent<TApi extends Api>(
	msg: AssistantMessage,
	model: Model<TApi>,
	toolCallIdMap: ToolCallIdMap,
	normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): AssistantMessage {
	const isSameModel = msg.provider === model.provider && msg.api === model.api && msg.model === model.id;

	const transformedContent = msg.content.flatMap((block) => {
		if (block.type === "thinking") {
			// thinking 块的处理规则
			if (block.redacted) {
				// 被屏蔽的 thinking：仅同模型保留
				return isSameModel ? block : [];
			}
			if (isSameModel && block.thinkingSignature) {
				// 同模型有签名：保留原始
				return block;
			}
			if (!block.thinking || block.thinking.trim() === "") {
				// 空 thinking：丢弃
				return [];
			}
			if (isSameModel) {
				// 同模型无签名但有内容：保留
				return block;
			}
			// 跨模型：转为 text
			return { type: "text" as const, text: block.thinking };
		}

		if (block.type === "text") {
			return isSameModel ? block : { type: "text" as const, text: block.text };
		}

		if (block.type === "toolCall") {
			const toolCall = block as ToolCall;

			// 跨模型移除 thought 相关的签名
			let normalizedToolCall: ToolCall = toolCall;
			if (!isSameModel && toolCall.thoughtSignature) {
				normalizedToolCall = { ...toolCall };
				delete (normalizedToolCall as { thoughtSignature?: string }).thoughtSignature;
			}

			// 跨模型 ID 标准化
			if (!isSameModel && normalizeToolCallId) {
				const normalizedId = normalizeToolCallId(toolCall.id, model, msg);
				if (normalizedId !== toolCall.id) {
					toolCallIdMap.set(toolCall.id, normalizedId);
					normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
				}
			}

			return normalizedToolCall;
		}

		return block;
	});

	return { ...msg, content: transformedContent };
}

/**
 * 转换消息内容（第一阶段）
 *
 * 1. user/toolResult 消息直接传递
 * 2. assistant 消息处理内容块
 * 3. 生成 toolCallId 映射表供后续使用
 */
function transformMessageContent<TApi extends Api>(
	messages: Message[],
	model: Model<TApi>,
	normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): { messages: Message[]; toolCallIdMap: ToolCallIdMap } {
	const toolCallIdMap: ToolCallIdMap = new Map();

	const transformed = messages.map((msg) => {
		if (msg.role === ROLE.USER) {
			return msg;
		}
		if (msg.role === ROLE.TOOL_RESULT) {
			// toolResult 的 toolCallId 需要应用标准化映射
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			if (normalizedId && normalizedId !== msg.toolCallId) {
				return { ...msg, toolCallId: normalizedId };
			}
			return msg;
		}
		if (msg.role === ROLE.ASSISTANT) {
			return transformAssistantContent(msg as AssistantMessage, model, toolCallIdMap, normalizeToolCallId);
		}
		return msg;
	});

	return { messages: transformed, toolCallIdMap };
}

/**
 * 转换消息列表
 *
 * 两阶段处理：
 * 1. 转换内容块（thinking/text/toolCall）
 * 2. 填充孤立的 toolCall 对应的缺失 toolResult
 */
export function transformMessages<TApi extends Api>(
	messages: Message[],
	model: Model<TApi>,
	normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): Message[] {
	// 阶段 1：转换内容
	const { messages: transformed } = transformMessageContent(messages, model, normalizeToolCallId);

	// 阶段 2：处理孤立 toolCall
	return fillOrphanToolResults(transformed);
}
