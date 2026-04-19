// src/tui/index.tsx
import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { logger } from "../utils/logger.js";

async function main() {
  try {
    const instance = await render(<App />);
    process.on("SIGINT", async () => {
      await instance.waitUntilExit();
      process.exit(0);
    });
  } catch (err) {
    logger.error("Failed to start TUI", { error: String(err) });
    process.exit(1);
  }
}

main();
