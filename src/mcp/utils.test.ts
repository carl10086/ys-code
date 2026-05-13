import { describe, it, expect } from "bun:test";
import { Type } from "@sinclair/typebox";
import { jsonSchemaToTypeBox } from "./utils.js";

describe("jsonSchemaToTypeBox", () => {
  it("转换 string 类型", () => {
    const result = jsonSchemaToTypeBox({ type: "string" });
    expect(result).toEqual(Type.String());
  });

  it("转换 number 类型", () => {
    const result = jsonSchemaToTypeBox({ type: "number" });
    expect(result).toEqual(Type.Number());
  });

  it("转换 boolean 类型", () => {
    const result = jsonSchemaToTypeBox({ type: "boolean" });
    expect(result).toEqual(Type.Boolean());
  });

  it("转换 object 类型（无 required）", () => {
    const result = jsonSchemaToTypeBox({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    });
    expect(result).toEqual(
      Type.Object({
        name: Type.Optional(Type.String()),
        age: Type.Optional(Type.Number()),
      }),
    );
  });

  it("转换 object 类型（有 required）", () => {
    const result = jsonSchemaToTypeBox({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
    });
    expect(result).toEqual(
      Type.Object({
        name: Type.String(),
        age: Type.Optional(Type.Number()),
      }),
    );
  });

  it("转换 array 类型", () => {
    const result = jsonSchemaToTypeBox({
      type: "array",
      items: { type: "string" },
    });
    expect(result).toEqual(Type.Array(Type.String()));
  });

  it("转换 enum", () => {
    const result = jsonSchemaToTypeBox({
      type: "string",
      enum: ["a", "b", "c"],
    });
    expect(result).toEqual(
      Type.Union([Type.Literal("a"), Type.Literal("b"), Type.Literal("c")]),
    );
  });

  it("转换嵌套 object", () => {
    const result = jsonSchemaToTypeBox({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            name: { type: "string" },
          },
          required: ["name"],
        },
      },
    });
    expect(result).toEqual(
      Type.Object({
        user: Type.Optional(
          Type.Object({
            name: Type.String(),
          }),
        ),
      }),
    );
  });

  it("不支持的类型 fallback 到 Type.Any()", () => {
    const result = jsonSchemaToTypeBox({ type: "null" });
    expect(result).toEqual(Type.Any());
  });

  it("缺少 type 时 fallback 到 Type.Any()", () => {
    const result = jsonSchemaToTypeBox({ description: "no type" });
    expect(result).toEqual(Type.Any());
  });
});
