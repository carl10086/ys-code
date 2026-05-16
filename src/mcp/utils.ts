import { Type, type TSchema } from "@sinclair/typebox";

export function jsonSchemaToTypeBox(schema: unknown): TSchema {
  if (typeof schema !== "object" || schema === null) {
    return Type.Any();
  }

  const s = schema as Record<string, unknown>;

  // Handle const before enum/type check
  if ("const" in s) {
    const constValue = s.const as string | number | boolean;
    return Type.Literal(constValue);
  }

  // Handle enum before type check
  if (Array.isArray(s.enum)) {
    const literals = s.enum.map((value) => Type.Literal(value as string));
    if (literals.length === 0) return Type.Any();
    if (literals.length === 1) return literals[0];
    return Type.Union(literals);
  }

  // Handle combinators before type check
  if (Array.isArray(s.oneOf)) {
    const schemas = s.oneOf.map((item) => jsonSchemaToTypeBox(item));
    if (schemas.length === 0) return Type.Any();
    if (schemas.length === 1) return schemas[0];
    return Type.Union(schemas);
  }

  if (Array.isArray(s.anyOf)) {
    const schemas = s.anyOf.map((item) => jsonSchemaToTypeBox(item));
    if (schemas.length === 0) return Type.Any();
    if (schemas.length === 1) return schemas[0];
    return Type.Union(schemas);
  }

  if (Array.isArray(s.allOf)) {
    const schemas = s.allOf.map((item) => jsonSchemaToTypeBox(item));
    if (schemas.length === 0) return Type.Any();
    if (schemas.length === 1) return schemas[0];
    return Type.Intersect(schemas);
  }

  // Handle $ref fallback
  if ("$ref" in s) {
    return Type.Any();
  }

  let result: TSchema;

  switch (s.type) {
    case "string":
      result = Type.String();
      break;
    case "number":
    case "integer":
      result = Type.Number();
      break;
    case "boolean":
      result = Type.Boolean();
      break;
    case "null":
      result = Type.Null();
      break;
    case "array": {
      const items = s.items ? jsonSchemaToTypeBox(s.items) : Type.Any();
      result = Type.Array(items);
      break;
    }
    case "object": {
      if (!s.properties || typeof s.properties !== "object") {
        result = Type.Object({});
      } else {
        const properties: Record<string, TSchema> = {};
        const required = new Set<string>(
          Array.isArray(s.required) ? (s.required as string[]) : [],
        );

        for (const [key, value] of Object.entries(s.properties)) {
          let fieldSchema = jsonSchemaToTypeBox(value);
          if (!required.has(key)) {
            fieldSchema = Type.Optional(fieldSchema);
          }
          properties[key] = fieldSchema;
        }

        const objectOptions: Record<string, unknown> = {};
        if ("additionalProperties" in s) {
          objectOptions.additionalProperties = s.additionalProperties;
        }

        result =
          Object.keys(objectOptions).length > 0
            ? Type.Object(properties, objectOptions)
            : Type.Object(properties);
      }
      break;
    }
    default:
      return Type.Any();
  }

  // Handle nullable: wrap in Union with Null
  if (s.nullable === true) {
    result = Type.Union([result, Type.Null()]);
  }

  return result;
}
