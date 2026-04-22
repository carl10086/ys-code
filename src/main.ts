import { Command } from "@commander-js/extra-typings";
import { createWebServer, stopWebServer } from "./web/index.js";
import { startTUI } from "./tui/index.js";
import { logger } from "./utils/logger.js";

const program = new Command()
  .name("ys-code")
  .description("ys-code - AI-powered coding assistant")
  .option("--web", "启动时同时开启 Web 预览");

async function main() {
  program.parse();
  const options = program.opts();

  let webServer: ReturnType<typeof createWebServer> | undefined;

  if (options.web) {
    try {
      webServer = createWebServer({
        port: 0,
        hostname: "127.0.0.1",
      });
      console.log(`Web server: ${webServer.url}`);
    } catch (err) {
      logger.error("Failed to start web server", { error: String(err) });
      process.exit(1);
    }
  }

  await startTUI();

  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    webServer?.stop();
    stopWebServer();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error("Unhandled error", { error: String(err) });
  process.exit(1);
});
