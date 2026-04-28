import { Type, type Static } from "@sinclair/typebox";
import { defineAgentTool } from "../define-agent-tool.js";
import type { AgentTool } from "../types.js";
import { validateUrl, truncateContent } from "./webfetch-utils.js";

const webFetchSchema = Type.Object({
  url: Type.String({ description: "The URL to fetch content from" }),
});

const webFetchOutputSchema = Type.Object({
  url: Type.String({ description: "The URL that was fetched" }),
  code: Type.Number({ description: "HTTP response code" }),
  codeText: Type.String({ description: "HTTP response code text" }),
  bytes: Type.Number({ description: "Size of the fetched content in bytes" }),
  result: Type.String({ description: "Processed content" }),
  durationMs: Type.Number({ description: "Time taken in milliseconds" }),
});

type WebFetchOutput = Static<typeof webFetchOutputSchema>;

const FETCH_TIMEOUT_MS = 60_000;
const MAX_HTTP_CONTENT_LENGTH = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;

/** Thrown for user-visible business errors (not network failures) */
class WebFetchUserError extends Error {}

/** @internal Test-only override for timeout */
export const __testConfig = {
  fetchTimeoutMs: FETCH_TIMEOUT_MS,
};

export function createWebFetchTool(): AgentTool<typeof webFetchSchema, WebFetchOutput> {
  return defineAgentTool({
    name: "WebFetch",
    label: "WebFetch",
    description: `Fetch content from a URL and return it as Markdown.

IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs. Before using this tool, check if the URL points to an authenticated service (e.g., Google Docs, Confluence, Jira, GitHub). If so, look for a specialized tool that provides authenticated access.

The tool fetches the raw content from the URL, converts HTML to Markdown if needed, truncates if too long, and returns the result.`,
    parameters: webFetchSchema,
    outputSchema: webFetchOutputSchema,
    isReadOnly: true,
    isConcurrencySafe: true,
    async validateInput(params, _context) {
      if (!validateUrl(params.url)) {
        return {
          ok: false,
          message: `Invalid or unsafe URL: "${params.url}". Only publicly accessible URLs are allowed.`,
        };
      }
      return { ok: true };
    },
    async execute(_toolCallId, params, context) {
      const start = Date.now();
      let url = params.url;

      if (context.abortSignal.aborted) {
        throw new Error("Aborted");
      }

      // Upgrade http to https
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol === "http:") {
          parsedUrl.protocol = "https:";
          url = parsedUrl.toString();
        }
      } catch {
        // Invalid URL, will fail later in fetch
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), __testConfig.fetchTimeoutMs);

      // Link the external abort signal
      const onAbort = () => controller.abort();
      context.abortSignal.addEventListener("abort", onAbort);

      try {
        let response = await fetch(url, {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            Accept: "text/markdown, text/html, */*",
          },
        });

        // Handle redirects manually with validation
        let redirectCount = 0;
        while (
          redirectCount < MAX_REDIRECTS &&
          [301, 302, 307, 308].includes(response.status)
        ) {
          const location = response.headers.get("location");
          if (!location) break;

          const newUrl = new URL(location, url).toString();
          if (!validateUrl(newUrl)) {
            throw new WebFetchUserError("Redirect to unsafe URL blocked");
          }

          url = newUrl;
          redirectCount++;

          response = await fetch(url, {
            signal: controller.signal,
            redirect: "manual",
            headers: {
              Accept: "text/markdown, text/html, */*",
            },
          });
        }

        const contentType = response.headers.get("content-type") || "";
        const rawBuffer = await response.arrayBuffer();
        const bytes = rawBuffer.byteLength;

        if (bytes > MAX_HTTP_CONTENT_LENGTH) {
          throw new WebFetchUserError(
            `Content too large: ${bytes} bytes (max ${MAX_HTTP_CONTENT_LENGTH} bytes)`,
          );
        }

        const text = new TextDecoder("utf-8", { fatal: false }).decode(rawBuffer);

        let result: string;
        if (contentType.includes("text/html")) {
          result = await convertHtmlToMarkdown(text);
        } else {
          result = text;
        }

        result = truncateContent(result);

        return {
          url,
          code: response.status,
          codeText: response.statusText,
          bytes,
          result,
          durationMs: Date.now() - start,
        };
      } catch (error) {
        // Sanitize error message to avoid information disclosure
        // Pass through user-facing business errors and abort signals
        if (error instanceof WebFetchUserError) {
          throw error;
        }
        if (error instanceof Error && error.message === "Aborted") {
          throw error;
        }
        throw new Error("Failed to fetch URL");
      } finally {
        clearTimeout(timeoutId);
        context.abortSignal.removeEventListener("abort", onAbort);
      }
    },
    formatResult(output) {
      return [{ type: "text", text: output.result }];
    },
  });
}

async function convertHtmlToMarkdown(html: string): Promise<string> {
  try {
    const Turndown = await import("turndown").then((m) => m.default);
    const turndownService = new Turndown();
    return turndownService.turndown(html);
  } catch {
    // Fallback: strip HTML tags if turndown is not available
    return html.replace(/<[^>]+>/g, "").trim();
  }
}
