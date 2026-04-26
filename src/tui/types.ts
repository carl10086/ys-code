// src/tui/types.ts

/** UI 消息类型 */
export type UIMessage =
  | { type: "user"; text: string; isMeta?: boolean }
  | { type: "system"; text: string }
  | { type: "assistant_start" }
  | { type: "thinking"; text: string }
  | { type: "text"; text: string }
  | { type: "tool_start"; toolName: string; args: unknown }
  | { type: "tool_end"; toolName: string; isError: boolean; summary: string; timeMs: number; renderData?: import("../agent/types.js").ToolRenderResult }
  | {
      type: "assistant_end";
      tokens: number;
      cost: number;
      timeMs: number;
    };
