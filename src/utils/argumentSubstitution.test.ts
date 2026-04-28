import { describe, it, expect } from "bun:test";
import {
  parseArguments,
  parseArgumentNames,
  substituteArguments,
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
});

describe("substituteArguments", () => {
  it("replaces $ARGUMENTS with full args", () => {
    expect(
      substituteArguments("Hello $ARGUMENTS", "world", false),
    ).toBe("Hello world");
  });

  it("replaces $ARGUMENTS multiple times", () => {
    expect(
      substituteArguments("$ARGUMENTS and $ARGUMENTS", "foo", false),
    ).toBe("foo and foo");
  });

  it("replaces $0, $1 shorthand", () => {
    expect(
      substituteArguments("First: $0, Second: $1", "a b", false),
    ).toBe("First: a, Second: b");
  });

  it("replaces $ARGUMENTS[0], $ARGUMENTS[1]", () => {
    expect(
      substituteArguments("First: $ARGUMENTS[0], Second: $ARGUMENTS[1]", "a b", false),
    ).toBe("First: a, Second: b");
  });

  it("replaces named arguments", () => {
    expect(
      substituteArguments("Name: $name, Age: $age", "Alice 30", false, [
        "name",
        "age",
      ]),
    ).toBe("Name: Alice, Age: 30");
  });

  it("does not replace $name when not in argumentNames", () => {
    expect(
      substituteArguments("Name: $name", "Alice", false),
    ).toBe("Name: $name");
  });

  it("replaces $10 as index 10", () => {
    // $10 is matched as index 10, not $1 followed by 0
    expect(
      substituteArguments("$10 dollars", "a", false),
    ).toBe(" dollars");
  });

  it("does not replace $name when followed by word char", () => {
    expect(
      substituteArguments("$nameX", "Alice", false, ["name"]),
    ).toBe("$nameX");
  });

  it("does not replace $ARGUMENTS inside code block (no special handling)", () => {
    // Note: substituteArguments itself does not skip code blocks
    // Code block skipping is done by the caller
    expect(
      substituteArguments("```\n$ARGUMENTS\n```", "foo", false),
    ).toBe("```\nfoo\n```");
  });

  it("appends ARGUMENTS when no placeholder found", () => {
    expect(
      substituteArguments("Hello world", "foo bar", true),
    ).toBe("Hello world\n\nARGUMENTS: foo bar");
  });

  it("does not append when appendIfNoPlaceholder is false", () => {
    expect(
      substituteArguments("Hello world", "foo bar", false),
    ).toBe("Hello world");
  });

  it("does not append when args is empty", () => {
    expect(
      substituteArguments("Hello world", "", true),
    ).toBe("Hello world");
  });

  it("returns content unchanged when args is undefined", () => {
    expect(
      substituteArguments("Hello $ARGUMENTS", undefined, false),
    ).toBe("Hello $ARGUMENTS");
  });

  it("handles missing indexed arguments", () => {
    expect(
      substituteArguments("$0 $1 $2", "only-one", false),
    ).toBe("only-one  ");
  });

  it("handles missing named arguments", () => {
    expect(
      substituteArguments("$a $b", "first", false, ["a", "b"]),
    ).toBe("first ");
  });

  it("handles named arguments with regex special characters", () => {
    expect(
      substituteArguments("Value: $foo.bar", "test", false, ["foo.bar"]),
    ).toBe("Value: test");
  });
});
