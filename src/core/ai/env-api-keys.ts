import type { KnownProvider } from "./types.js";

export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: any): string | undefined {
	const envMap: Record<string, string> = {
		minimax: "MINIMAX_API_KEY",
		"minimax-cn": "MINIMAX_CN_API_KEY",
	};
	const envVar = envMap[provider];
	return envVar ? process.env[envVar] : undefined;
}
