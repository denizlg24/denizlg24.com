import type { Document } from "mongodb";

import type { FieldMapping } from "../db/schema";

function stringifyIdentifier(value: unknown): string {
  if (value === null || value === undefined) {
    throw new Error("Identifier cannot be null or undefined");
  }
  return String(value);
}

export function transformPgRow(
  row: Record<string, unknown>,
  idColumn: string,
  mapping: FieldMapping,
): Record<string, unknown> {
  const rawId = row[idColumn];
  if (rawId === null || rawId === undefined) {
    throw new Error(`Row missing id column "${idColumn}"`);
  }

  const result: Record<string, unknown> = {
    id: stringifyIdentifier(rawId),
  };

  for (const [key, value] of Object.entries(row)) {
    if (key === idColumn) {
      continue;
    }
    if (
      mapping.includeFields &&
      mapping.includeFields.length > 0 &&
      !mapping.includeFields.includes(key)
    ) {
      continue;
    }
    if (mapping.excludeFields?.includes(key)) {
      continue;
    }

    const coerced = coerceValue(value);
    if (coerced !== undefined) {
      result[key] = coerced;
    }
  }
  return result;
}

export function transformDocument(
  document: Document,
  mapping: FieldMapping,
): Record<string, unknown> {
  const idField = mapping.primaryKey ?? "_id";
  const rawId = document[idField] ?? document._id;
  const result: Record<string, unknown> = {
    id: stringifyIdentifier(rawId),
  };

  for (const [key, value] of Object.entries(document)) {
    if (key === "_id") {
      continue;
    }
    if (
      mapping.includeFields &&
      mapping.includeFields.length > 0 &&
      !mapping.includeFields.includes(key)
    ) {
      continue;
    }
    if (mapping.excludeFields?.includes(key)) {
      continue;
    }

    const coerced = coerceValue(value);
    if (coerced !== undefined) {
      result[key] = coerced;
    }
  }
  return result;
}

function coerceValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }
  if (
    typeof value === "object" &&
    "toHexString" in value &&
    typeof value.toHexString === "function"
  ) {
    return value.toHexString();
  }
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map(coerceValue).filter((item) => item !== undefined);
  }
  if (typeof value === "object") {
    const object: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const coerced = coerceValue(nestedValue);
      if (coerced !== undefined) {
        object[key] = coerced;
      }
    }
    return object;
  }

  return value;
}
