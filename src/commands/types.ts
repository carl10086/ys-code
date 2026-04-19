// src/commands/types.ts
import type React from "react";

/** 命令执行上下文 */
export interface CommandContext {
  /** AgentSession 实例 */
  session: import("../agent/session.js").AgentSession;
  /** 添加用户可见消息到 UI */
  appendUserMessage: (text: string) => void;
  /** 添加系统消息（灰色，模型不可见） */
  appendSystemMessage: (text: string) => void;
}

/** 本地命令执行结果 */
export type CommandResult =
  | { type: "text"; value: string }
  | { type: "skip" };

/** 命令基础结构 */
export interface CommandBase {
  /** 命令名称 */
  name: string;
  /** 命令描述（用于帮助文本） */
  description: string;
  /** 别名列表 */
  aliases?: string[];
  /** 是否可用，默认 true */
  isEnabled?: () => boolean;
  /** 是否在帮助中隐藏 */
  isHidden?: boolean;
  /** 是否立即执行（绕过队列） */
  immediate?: boolean;
}

/** 本地命令实现签名 */
export type LocalCommandCall = (
  args: string,
  context: CommandContext,
) => Promise<CommandResult>;

/** 本地命令懒加载模块 */
export type LocalCommandModule = {
  call: LocalCommandCall;
};

/** 本地命令：执行函数，返回文本结果 */
export interface LocalCommand extends CommandBase {
  type: "local";
  /** 懒加载实现模块 */
  load: () => Promise<LocalCommandModule>;
}

/** local-jsx 命令完成回调 */
export type LocalJSXCommandOnDone = (result?: string) => void;

/** local-jsx 命令实现签名 */
export type LocalJSXCommandCall = (
  onDone: LocalJSXCommandOnDone,
  context: CommandContext,
  args: string,
) => Promise<React.ReactNode>;

/** local-jsx 命令懒加载模块 */
export type LocalJSXCommandModule = {
  call: LocalJSXCommandCall;
};

/** local-jsx 命令：渲染 React 组件 */
export interface LocalJSXCommand extends CommandBase {
  type: "local-jsx";
  /** 懒加载实现模块 */
  load: () => Promise<LocalJSXCommandModule>;
}

/** Command 联合类型 */
export type Command = LocalCommand | LocalJSXCommand;

/** 获取命令显示名称 */
export function getCommandName(cmd: CommandBase): string {
  return cmd.name;
}

/** 检查命令是否可用 */
export function isCommandEnabled(cmd: CommandBase): boolean {
  return cmd.isEnabled?.() ?? true;
}
