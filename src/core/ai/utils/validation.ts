// src/core/ai/utils/validation.ts
import AjvModule from "ajv";
import addFormatsModule from "ajv-formats";
import type { Tool, ToolCall } from "../types.js";

const Ajv = (AjvModule as any).default || AjvModule;
const addFormats = (addFormatsModule as any).default || addFormatsModule;

// 检测浏览器扩展环境
const isBrowserExtension = typeof globalThis !== "undefined" && (globalThis as any).chrome?.runtime?.id !== undefined;

function canUseRuntimeCodegen(): boolean {
  if (isBrowserExtension) return false;
  try {
    new Function("return true;");
    return true;
  } catch {
    return false;
  }
}

// 创建单例 AJV 实例
let ajv: any = null;
if (canUseRuntimeCodegen()) {
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

/**
 * 验证工具调用参数
 */
export function validateToolArguments(tool: Tool, toolCall: ToolCall): any {
  if (!ajv || !canUseRuntimeCodegen()) {
    return toolCall.arguments;
  }
  const validate = ajv.compile(tool.parameters);
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
