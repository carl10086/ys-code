/**
 * Utility for substituting $ARGUMENTS placeholders in skill/command prompts.
 *
 * Supports:
 * - $ARGUMENTS - replaced with the full arguments string
 * - $ARGUMENTS[0], $ARGUMENTS[1], etc. - replaced with individual indexed arguments
 * - $0, $1, etc. - shorthand for $ARGUMENTS[0], $ARGUMENTS[1]
 * - Named arguments (e.g., $foo, $bar) - when argument names are defined in frontmatter
 */

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
    typeof name === "string" && name.trim() !== "" && /^\d+$/.test(name) === false;

  if (Array.isArray(argumentNames)) {
    return argumentNames.filter(isValidName);
  }
  if (typeof argumentNames === "string") {
    return argumentNames.split(/\s+/).filter(isValidName);
  }
  return [];
}

/**
 * Substitute $ARGUMENTS placeholders in content with actual argument values.
 *
 * @param content - The content containing placeholders
 * @param args - The raw arguments string (may be undefined/null)
 * @param appendIfNoPlaceholder - If true and no placeholders are found, appends "ARGUMENTS: {args}" to content
 * @param argumentNames - Optional array of named arguments (e.g., ["foo", "bar"]) that map to indexed positions
 * @returns The content with placeholders substituted
 */
export function substituteArguments(
  content: string,
  args: string | undefined,
  appendIfNoPlaceholder = true,
  argumentNames: string[] = [],
): string {
  if (args === undefined || args === null) {
    return content;
  }

  const parsedArgs = parseArguments(args);
  const originalContent = content;

  // Replace named arguments (e.g., $foo, $bar) with their values
  // Named arguments map to positions: argumentNames[0] -> parsedArgs[0], etc.
  for (let i = 0; i < argumentNames.length; i++) {
    const name = argumentNames[i];
    if (!name) continue;

    // Match $name but not $name[...] or $nameXxx (word chars)
    content = content.replace(
      new RegExp(`\\$${name}(?![\\[\\w])`, "g"),
      parsedArgs[i] ?? "",
    );
  }

  // Replace indexed arguments ($ARGUMENTS[0], $ARGUMENTS[1], etc.)
  content = content.replace(/\$ARGUMENTS\[(\d+)\]/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10);
    return parsedArgs[index] ?? "";
  });

  // Replace shorthand indexed arguments ($0, $1, etc.)
  content = content.replace(/\$(\d+)(?!\w)/g, (_, indexStr: string) => {
    const index = parseInt(indexStr, 10);
    return parsedArgs[index] ?? "";
  });

  // Replace $ARGUMENTS with the full arguments string
  content = content.replaceAll("$ARGUMENTS", args);

  // If no placeholders were found and appendIfNoPlaceholder is true, append
  if (content === originalContent && appendIfNoPlaceholder && args) {
    content = content + `\n\nARGUMENTS: ${args}`;
  }

  return content;
}
