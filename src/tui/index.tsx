// src/tui/index.tsx
import { render } from "ink";
import React from "react";
import { App } from "./app.js";
import { logger } from "../utils/logger.js";

export interface StartTUIOptions {
  webUrl?: string;
}

export async function startTUI(options?: StartTUIOptions): Promise<void> {
  try {
    const instance = await render(<App webUrl={options?.webUrl} />);
    logger.info("TUI started");
    process.on("SIGINT", async () => {
      logger.info("TUI exiting (SIGINT)");
      await instance.waitUntilExit();
      process.exit(0);
    });
  } catch (err) {
    logger.error("Failed to start TUI", { error: String(err) });
    process.exit(1);
  }
}

if (import.meta.main) {
  startTUI();
}
