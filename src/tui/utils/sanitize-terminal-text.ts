import stripAnsi from "strip-ansi";

export function sanitizeTerminalText(text: string): string {
  const withoutOsc = text
    .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\][^\u0007\u001B]*/g, "");
  return stripAnsi(withoutOsc).replace(/[\u0000-\u0008\u000B\u000C\u000D\u000E-\u001F\u007F-\u009F]/g, "");
}
