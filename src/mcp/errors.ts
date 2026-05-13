export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

export class McpConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConnectionError";
  }
}
