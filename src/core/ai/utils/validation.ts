// src/core/ai/utils/validation.ts
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import type { Tool, ToolCall } from "../types.js";

// ESM/CJS 兼容处理：某些环境（如 Vite）将 ESM 模块的 default 导出放在 .default 属性上
const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

// 检测浏览器扩展环境（CJS/ESM 兼容处理）
const isBrowserExtension = typeof globalThis !== "undefined" && (globalThis as any).chrome?.runtime?.id !== undefined;

// 缓存 canUseRuntimeCodegen 结果，避免重复检测
const canUseCodegen = (() => {
  if (isBrowserExtension) return false;
  try {
    new Function("return true;");
    return true;
  } catch {
    return false;
  }
})();

// 单例 AJV 实例
let ajv: any = null;
if (canUseCodegen) {
  try {
    ajv = new Ajv({
      allErrors: true,
      strict: false,
      coerceTypes: true,
    });
    addFormats(ajv);
  } catch (_e) {
    console.warn("AJV validation disabled due to CSP restrictions");
  }
}

// 缓存编译好的 validators，避免重复编译
const validatorCache = new Map<string, any>();

/**
 * 验证工具调用参数
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
  if (!ajv || !canUseCodegen) {
    return toolCall.arguments;
  }

  let validate = validatorCache.get(tool.name);
  if (!validate) {
    validate = ajv.compile(tool.parameters);
    validatorCache.set(tool.name, validate);
  }

  const args = structuredClone(toolCall.arguments);
  if (validate(args)) {
    return args;
  }
  const errors = validate.errors?.map((err: any) => {
    const path = err.instancePath ? err.instancePath.substring(1) : err.params.missingProperty || "root";
    return `  - ${path}: ${err.message}`;
  }).join("\n") || "Unknown validation error";
  const errorMessage = `Validation failed for tool "${toolCall.name}":\n${errors}`;
  throw new Error(errorMessage);
}
