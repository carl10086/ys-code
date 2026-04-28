import { describe, it, expect } from "bun:test";
import {
  parseArguments,
  parseArgumentNames,
  substituteArguments,
  ARGUMENTS_APPEND_PREFIX,
} from "./argumentSubstitution.js";

describe("parseArguments", () => {
  it("splits by whitespace", () => {
    expect(parseArguments("foo bar baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("collapses multiple spaces", () => {
    expect(parseArguments("foo  bar   baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("returns empty array for empty string", () => {
    expect(parseArguments("")).toEqual([]);
  });

  it("returns empty array for whitespace only", () => {
    expect(parseArguments("   ")).toEqual([]);
  });

  it("returns empty array for undefined", () => {
    expect(parseArguments(undefined as unknown as string)).toEqual([]);
  });
});

describe("parseArgumentNames", () => {
  it("parses space-separated string", () => {
    expect(parseArgumentNames("foo bar baz")).toEqual(["foo", "bar", "baz"]);
  });

  it("parses string array", () => {
    expect(parseArgumentNames(["foo", "bar", "baz"])).toEqual([
      "foo",
      "bar",
      "baz",
    ]);
  });

  it("filters numeric-only names", () => {
    expect(parseArgumentNames(["foo", "123", "bar"])).toEqual(["foo", "bar"]);
  });

  it("filters empty strings", () => {
    expect(parseArgumentNames(["foo", "", "bar"])).toEqual(["foo", "bar"]);
  });

  it("returns empty array for undefined", () => {
    expect(parseArgumentNames(undefined)).toEqual([]);
  });

  it("filters forbidden names (__proto__, constructor, prototype)", () => {
    expect(
      parseArgumentNames(["foo", "__proto__", "constructor", "prototype", "bar"]),
    ).toEqual(["foo", "bar"]);
  });
});

describe("substituteArguments", () => {
  it("replaces $ARGUMENTS with full args", () => {
    expect(
      substituteArguments("Hello $ARGUMENTS", "world", false),
    ).toEqual({ content: "Hello world", hasReplaced: true });
  });

  it("replaces $ARGUMENTS multiple times", () => {
    expect(
      substituteArguments("$ARGUMENTS and $ARGUMENTS", "foo", false),
    ).toEqual({ content: "foo and foo", hasReplaced: true });
  });

  it("replaces $0, $1 shorthand", () => {
    expect(
      substituteArguments("First: $0, Second: $1", "a b", false),
    ).toEqual({ content: "First: a, Second: b", hasReplaced: true });
  });

  it("replaces $ARGUMENTS[0], $ARGUMENTS[1]", () => {
    expect(
      substituteArguments("First: $ARGUMENTS[0], Second: $ARGUMENTS[1]", "a b", false),
    ).toEqual({ content: "First: a, Second: b", hasReplaced: true });
  });

  it("replaces named arguments", () => {
    expect(
      substituteArguments("Name: $name, Age: $age", "Alice 30", false, [
        "name",
        "age",
      ]),
    ).toEqual({ content: "Name: Alice, Age: 30", hasReplaced: true });
  });

  it("does not replace $name when not in argumentNames", () => {
    expect(
      substituteArguments("Name: $name", "Alice", false),
    ).toEqual({ content: "Name: $name", hasReplaced: false });
  });

  it("replaces $10 as index 10", () => {
    // $10 is matched as index 10, not $1 followed by 0
    expect(
      substituteArguments("$10 dollars", "a", false),
    ).toEqual({ content: " dollars", hasReplaced: true });
  });

  it("does not replace $name when followed by word char", () => {
    expect(
      substituteArguments("$nameX", "Alice", false, ["name"]),
    ).toEqual({ content: "$nameX", hasReplaced: false });
  });

  it("does not replace $ARGUMENTS inside code block (no special handling)", () => {
    // Note: substituteArguments itself does not skip code blocks
    // Code block skipping is done by the caller
    expect(
      substituteArguments("```\n$ARGUMENTS\n```", "foo", false),
    ).toEqual({ content: "```\nfoo\n```", hasReplaced: true });
  });

  it("appends ARGUMENTS when no placeholder found", () => {
    expect(
      substituteArguments("Hello world", "foo bar", true),
    ).toEqual({ content: `Hello world\n\n${ARGUMENTS_APPEND_PREFIX} foo bar`, hasReplaced: false });
  });

  it("does not append when appendIfNoPlaceholder is false", () => {
    expect(
      substituteArguments("Hello world", "foo bar", false),
    ).toEqual({ content: "Hello world", hasReplaced: false });
  });

  it("does not append when args is empty", () => {
    expect(
      substituteArguments("Hello world", "", true),
    ).toEqual({ content: "Hello world", hasReplaced: false });
  });

  it("returns content unchanged when args is undefined", () => {
    expect(
      substituteArguments("Hello $ARGUMENTS", undefined, false),
    ).toEqual({ content: "Hello $ARGUMENTS", hasReplaced: false });
  });

  it("handles missing indexed arguments", () => {
    expect(
      substituteArguments("$0 $1 $2", "only-one", false),
    ).toEqual({ content: "only-one  ", hasReplaced: true });
  });

  it("handles missing named arguments", () => {
    expect(
      substituteArguments("$a $b", "first", false, ["a", "b"]),
    ).toEqual({ content: "first ", hasReplaced: true });
  });

  it("handles named arguments with regex special characters", () => {
    expect(
      substituteArguments("Value: $foo.bar", "test", false, ["foo.bar"]),
    ).toEqual({ content: "Value: test", hasReplaced: true });
  });

  it("throws when args exceeds maximum length", () => {
    const longArgs = "x".repeat(10001);
    expect(() =>
      substituteArguments("Hello", longArgs, false),
    ).toThrow("Arguments exceed maximum length");
  });

  it("throws when content exceeds maximum length", () => {
    const longContent = "x".repeat(100001);
    expect(() =>
      substituteArguments(longContent, "hello", false),
    ).toThrow("Content exceeds maximum length");
  });

  it("hasReplaced is true when only named argument matches", () => {
    expect(
      substituteArguments("$foo", "bar", false, ["foo"]),
    ).toEqual({ content: "bar", hasReplaced: true });
  });

  it("hasReplaced is false when no substitution occurs", () => {
    expect(
      substituteArguments("No placeholders here", "foo", false),
    ).toEqual({ content: "No placeholders here", hasReplaced: false });
  });
});
