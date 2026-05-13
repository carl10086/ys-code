import { Type, type TSchema } from "@sinclair/typebox";

export function jsonSchemaToTypeBox(schema: unknown): TSchema {
  if (typeof schema !== "object" || schema === null) {
    return Type.Any();
  }

  const s = schema as Record<string, unknown>;

  // Handle enum before type check
  if (Array.isArray(s.enum)) {
    const literals = s.enum.map((value) => Type.Literal(value as string));
    if (literals.length === 0) return Type.Any();
    if (literals.length === 1) return literals[0];
    return Type.Union(literals);
  }

  switch (s.type) {
    case "string":
      return Type.String();
    case "number":
    case "integer":
      return Type.Number();
    case "boolean":
      return Type.Boolean();
    case "array": {
      const items = s.items ? jsonSchemaToTypeBox(s.items) : Type.Any();
      return Type.Array(items);
    }
    case "object": {
      if (!s.properties || typeof s.properties !== "object") {
        return Type.Object({});
      }

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

      return Type.Object(properties);
    }
    default:
      return Type.Any();
  }
}
