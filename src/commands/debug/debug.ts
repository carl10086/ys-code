// src/commands/debug/debug.ts
import type { LocalCommandCall } from "../../commands/types.js";

export const call: LocalCommandCall = async () => {
  return {
    type: "text",
    value: "Debug Inspector: http://127.0.0.1/debug\n\n提示: 需要启动时添加 --web 参数开启 Web 服务器",
  };
};
