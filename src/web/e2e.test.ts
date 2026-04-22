import { describe, it, expect } from "bun:test";
import { createWebServer } from "./index.js";

describe("Web Framework E2E", () => {
  it("should serve health check and home page", async () => {
    const server = createWebServer();

    try {
      // health check
      const healthRes = await fetch(`${server.url}/health`);
      expect(healthRes.status).toBe(200);
      const health = await healthRes.json();
      expect(health.status).toBe("ok");
      expect(health.pid).toBe(process.pid);

      // home page
      const homeRes = await fetch(server.url);
      expect(homeRes.status).toBe(200);
      expect(homeRes.headers.get("Content-Type")).toContain("text/html");

      // 404
      const notFoundRes = await fetch(`${server.url}/not-exist`);
      expect(notFoundRes.status).toBe(404);
    } finally {
      server.stop();
    }
  });
});
