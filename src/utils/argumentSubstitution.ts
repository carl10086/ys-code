/**
 * Utility for substituting $ARGUMENTS placeholders in skill/command prompts.
 *
 * Supports:
 * - $ARGUMENTS - replaced with the full arguments string
 * - $ARGUMENTS[0], $ARGUMENTS[1], etc. - replaced with individual indexed arguments
 * - $0, $1, etc. - shorthand for $ARGUMENTS[0], $ARGUMENTS[1]
 * - Named arguments (e.g., $foo, $bar) - when argument names are defined in frontmatter
 */

const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"]);

const MAX_ARGS_LENGTH = 10000;
const MAX_CONTENT_LENGTH = 100000;

/** Prefix used when auto-appending arguments to content */
export const ARGUMENTS_APPEND_PREFIX = "ARGUMENTS:";

// Escape special regex characters for safe interpolation
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Parse an arguments string into an array of individual arguments.
 * Uses simple whitespace split (not shell-quote).
 *
 * Examples:
 * - "foo bar baz" => ["foo", "bar", "baz"]
 * - "foo  bar" => ["foo", "bar"] (collapses multiple spaces)
 */
export function parseArguments(args: string): string[] {
  if (!args || !args.trim()) {
    return [];
  }
  return args.split(/\s+/).filter(Boolean);
}

/**
 * Parse argument names from the frontmatter 'arguments' field.
 * Accepts either a space-separated string or an array of strings.
 *
 * Examples:
 * - "foo bar baz" => ["foo", "bar", "baz"]
 * - ["foo", "bar", "baz"] => ["foo", "bar", "baz"]
 */
export function parseArgumentNames(
  argumentNames: string | string[] | undefined,
): string[] {
  if (!argumentNames) {
    return [];
  }

  const isValidName = (name: string): boolean =>
    typeof name === "string" &&
    name.trim() !== "" &&
    /^\d+$/.test(name) === false &&
    !FORBIDDEN_NAMES.has(name);

  if (Array.isArray(argumentNames)) {
    return argumentNames.filter(isValidName);
  }
  if (typeof argumentNames === "string") {
    return argumentNames.split(/\s+/).filter(isValidName);
  }
  return [];
}

export interface SubstituteArgumentsResult {
  content: string;
  hasReplaced: boolean;
}

/**
 * Substitute $ARGUMENTS placeholders in content with actual argument values.
 *
 * @param content - The content containing placeholders
 * @param args - The raw arguments string (may be undefined/null)
 * @param appendIfNoPlaceholder - If true and no placeholders are found, appends "ARGUMENTS: {args}" to content
 * @param argumentNames - Optional array of named arguments (e.g., ["foo", "bar"]) that map to indexed positions
 * @returns { content, hasReplaced } - The substituted content and whether any replacement occurred
 */
export function substituteArguments(
  content: string,
  args: string | undefined,
  appendIfNoPlaceholder = false,
  argumentNames: string[] = [],
): SubstituteArgumentsResult {
  if (args === undefined || args === null) {
    return { content, hasReplaced: false };
  }

  if (args.length > MAX_ARGS_LENGTH) {
    throw new Error(`Arguments exceed maximum length of ${MAX_ARGS_LENGTH}`);
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(`Content exceeds maximum length of ${MAX_CONTENT_LENGTH}`);
  }

  const parsedArgs = parseArguments(args);
  let hasReplaced = false;

  // Replace named arguments (e.g., $foo, $bar) with their values
  // Named arguments map to positions: argumentNames[0] -> parsedArgs[0], etc.
  for (let i = 0; i < argumentNames.length; i++) {
    const name = argumentNames[i];
    if (!name) continue;

    // Match $name but not $name[...] or $nameXxx (word chars)
    const pattern = new RegExp(
      `\\$${escapeRegExp(name)}(?![\\[\\w])`,
      "g",
    );
    if (pattern.test(content)) {
      hasReplaced = true;
      content = content.replace(pattern, parsedArgs[i] ?? "");
    }
  }

  // Replace indexed arguments ($ARGUMENTS[0], $ARGUMENTS[1], etc.)
  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10);
    hasReplaced = true;
    return parsedArgs[index] ?? "";
  });

  // Replace shorthand indexed arguments ($0, $1, etc.)
  content = content.replace(/\$(\d+)(?!\w)/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10);
    hasReplaced = true;
    return parsedArgs[index] ?? "";
  });

  // Replace $ARGUMENTS with the full arguments string
  if (content.includes("$ARGUMENTS")) {
    hasReplaced = true;
    content = content.replaceAll("$ARGUMENTS", args);
  }

  // If no placeholders were found and appendIfNoPlaceholder is true, append
  if (!hasReplaced && appendIfNoPlaceholder && args) {
    content = content + `\n\n${ARGUMENTS_APPEND_PREFIX} ${args}`;
  }

  return { content, hasReplaced };
}
