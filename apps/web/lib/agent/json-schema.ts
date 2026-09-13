import type { JSONSchema7 } from "ai";

type JSONSchema7Definition = NonNullable<JSONSchema7["properties"]>[string];
type JSONSchema7TypeName = Extract<JSONSchema7["type"], string>;

const TYPE_NAMES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
  "null",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTypeName(value: unknown): value is JSONSchema7TypeName {
  return typeof value === "string" && TYPE_NAMES.has(value);
}

type EnumValue = string | number | boolean | null;

function isEnumValue(value: unknown): value is EnumValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function definition(value: unknown): JSONSchema7Definition {
  if (typeof value === "boolean") return value;
  return toJsonSchema7(value);
}

/**
 * Rebuilds a JSON Schema from an untyped literal, keeping the keywords the
 * built-in tools use. Anything unrecognised is dropped rather than asserted.
 */
export function toJsonSchema7(value: unknown): JSONSchema7 {
  if (!isRecord(value)) return {};
  const schema: JSONSchema7 = {};
  if (isTypeName(value.type)) schema.type = value.type;
  if (Array.isArray(value.type)) schema.type = value.type.filter(isTypeName);
  if (typeof value.description === "string") {
    schema.description = value.description;
  }
  if (typeof value.format === "string") schema.format = value.format;
  if (typeof value.minimum === "number") schema.minimum = value.minimum;
  if (typeof value.maximum === "number") schema.maximum = value.maximum;
  if (typeof value.minLength === "number") schema.minLength = value.minLength;
  if (typeof value.maxLength === "number") schema.maxLength = value.maxLength;
  if (typeof value.minItems === "number") schema.minItems = value.minItems;
  if (typeof value.maxItems === "number") schema.maxItems = value.maxItems;
  if (Array.isArray(value.enum)) schema.enum = value.enum.filter(isEnumValue);
  if (Array.isArray(value.required)) {
    schema.required = value.required.filter(
      (entry): entry is string => typeof entry === "string",
    );
  }
  if (isRecord(value.properties)) {
    schema.properties = Object.fromEntries(
      Object.entries(value.properties).map(([key, entry]) => [
        key,
        definition(entry),
      ]),
    );
  }
  if (value.items !== undefined && !Array.isArray(value.items)) {
    schema.items = definition(value.items);
  }
  if (
    typeof value.additionalProperties === "boolean" ||
    isRecord(value.additionalProperties)
  ) {
    schema.additionalProperties = definition(value.additionalProperties);
  }
  if (Array.isArray(value.anyOf)) schema.anyOf = value.anyOf.map(definition);
  if (Array.isArray(value.oneOf)) schema.oneOf = value.oneOf.map(definition);
  return schema;
}
