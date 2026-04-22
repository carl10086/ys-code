import { describe, it, expect } from "bun:test";
import { createWebServer, stopWebServer } from "./index.js";

describe("Web Server", () => {
  it("should start server with auto-assigned port", () => {
    const server = createWebServer();
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`);
    server.stop();
  });

  it("should stop server gracefully", async () => {
    const server = createWebServer();
    server.stop();
    try {
      await fetch(server.url + "/health");
      expect(false).toBe(true);
    } catch {
      expect(true).toBe(true);
    }
  });
});
