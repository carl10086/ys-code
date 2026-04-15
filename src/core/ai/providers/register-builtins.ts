import { clearApiProviders, registerApiProvider } from "../api-registry.js";
import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import type { AnthropicOptions } from "./anthropic.js";

/** 懒加载 provider 模块接口 */
interface LazyProviderModule<
	TApi extends Api,
	TOptions extends StreamOptions,
	TSimpleOptions extends SimpleStreamOptions,
> {
	stream: (model: Model<TApi>, context: Context, options?: TOptions) => AsyncIterable<AssistantMessageEvent>;
	streamSimple: (model: Model<TApi>, context: Context, options?: TSimpleOptions) => AsyncIterable<AssistantMessageEvent>;
}

/** Anthropic provider 模块接口 */
interface AnthropicProviderModule {
	streamAnthropic: StreamFunction<"anthropic-messages", AnthropicOptions>;
	streamSimpleAnthropic: StreamFunction<"anthropic-messages", SimpleStreamOptions>;
}

/** 缓存的 provider 模块 promise */
let anthropicProviderModulePromise:
	| Promise<LazyProviderModule<"anthropic-messages", AnthropicOptions, SimpleStreamOptions>>
	| undefined;

/**
 * 转发源可迭代对象的事件到目标流
 */
function forwardStream(target: AssistantMessageEventStream, source: AsyncIterable<AssistantMessageEvent>): void {
	(async () => {
		for await (const event of source) {
			target.push(event);
		}
		target.end();
	})();
}

/**
 * 创建懒加载错误消息
 */
function createLazyLoadErrorMessage<TApi extends Api>(model: Model<TApi>, error: unknown): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage: error instanceof Error ? error.message : String(error),
		timestamp: Date.now(),
	};
}

/**
 * 创建懒加载流函数
 *
 * @param getStreamMethod 获取流方法的函数（支持 stream 或 streamSimple）
 */
function createLazyStream<TApi extends Api, TOptions extends StreamOptions>(
	loadModule: () => Promise<LazyProviderModule<TApi, TOptions, SimpleStreamOptions>>,
	getStreamMethod: (module: LazyProviderModule<TApi, TOptions, SimpleStreamOptions>) =>
		(model: Model<TApi>, context: Context, options?: TOptions) => AsyncIterable<AssistantMessageEvent>,
): StreamFunction<TApi, TOptions> {
	return (model, context, options) => {
		const outer = new AssistantMessageEventStream();
		loadModule()
			.then((module) => {
				const streamMethod = getStreamMethod(module);
				const inner = streamMethod(model, context, options);
				forwardStream(outer, inner);
			})
			.catch((error) => {
				const message = createLazyLoadErrorMessage(model, error);
				outer.push({ type: "error", reason: "error", error: message });
				outer.end(message);
			});
		return outer;
	};
}

/** 加载 Anthropic provider 模块 */
function loadAnthropicProviderModule(): Promise<
	LazyProviderModule<"anthropic-messages", AnthropicOptions, SimpleStreamOptions>
> {
	anthropicProviderModulePromise ||= import("./anthropic.js").then((module) => {
		const provider = module as AnthropicProviderModule;
		return {
			stream: provider.streamAnthropic,
			streamSimple: provider.streamSimpleAnthropic,
		};
	});
	return anthropicProviderModulePromise;
}

// 创建流函数：stream 和 streamSimple
export const streamAnthropic = createLazyStream(loadAnthropicProviderModule, (m) => m.stream);
export const streamSimpleAnthropic = createLazyStream(loadAnthropicProviderModule, (m) => m.streamSimple);

export function registerBuiltInApiProviders(): void {
	registerApiProvider({
		api: "anthropic-messages",
		stream: streamAnthropic,
		streamSimple: streamSimpleAnthropic,
	});
}

export function resetApiProviders(): void {
	clearApiProviders();
	registerBuiltInApiProviders();
}

registerBuiltInApiProviders();
