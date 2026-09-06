import { z } from "zod";

import type { ToolDefinition, ToolExecutionContext, ToolSchema } from "./types";

/**
 * A tool input that did not match its declared schema. Distinct from any error
 * the handler itself raises: nothing ran, and the model can fix it by reissuing
 * the call with corrected arguments — which is only true if the message says
 * which field was wrong.
 */
export class ToolInputError extends Error {
  constructor(
    readonly toolName: string,
    readonly issues: z.core.$ZodIssue[],
    message: string,
  ) {
    super(message);
    this.name = "ToolInputError";
  }
}

function formatPath(path: readonly PropertyKey[]): string {
  if (path.length === 0) return "(root)";
  return path
    .map((segment, index) =>
      typeof segment === "number"
        ? `[${segment}]`
        : index === 0
          ? String(segment)
          : `.${String(segment)}`,
    )
    .join("");
}

function valueAtPath(input: unknown, path: readonly PropertyKey[]): unknown {
  let cursor = input;
  for (const segment of path) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<PropertyKey, unknown>)[segment];
  }
  return cursor;
}

function describeValue(value: unknown): string {
  if (value === undefined) return "nothing";
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return typeof value;
    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return typeof value;
  }
}

/**
 * What the model reads when a call is rejected. Zod's own message names the
 * expectation; the received value is added because "expected one of a|b|c" does
 * not on its own tell the model whether it sent the wrong value, the wrong
 * field, or nothing at all.
 */
export function describeInputIssues(
  toolName: string,
  input: unknown,
  issues: readonly z.core.$ZodIssue[],
): string {
  const lines = issues.map((issue) => {
    const received = describeValue(valueAtPath(input, issue.path));
    return `  ${formatPath(issue.path)}: ${issue.message} (received ${received})`;
  });
  return `Invalid input for ${toolName}. Fix these arguments and call it again:\n${lines.join("\n")}`;
}

/**
 * Every Mongo id the model is handed is a 24-character hex string. Without the
 * shape check a made-up id reaches Mongoose as a `CastError` naming neither the
 * field nor the tool, which ends the turn instead of correcting it — the exact
 * failure this module exists to stop. It cannot reject a call that used to
 * work: anything failing this already threw.
 */
export function objectId(description: string) {
  return z
    .string()
    .regex(
      /^[0-9a-fA-F]{24}$/,
      "expected a 24-character hex MongoDB id, e.g. 507f1f77bcf86cd799439011",
    )
    .describe(description);
}

type ToolSpec<T extends z.ZodObject> = {
  name: string;
  description: string;
  /** The single description of the shape. The JSON Schema is derived from it. */
  input: T;
  isWrite: boolean;
  category: string;
  runtime?: "server" | "client";
  execute?: (
    input: z.output<T>,
    context?: ToolExecutionContext,
  ) => Promise<unknown>;
};

/**
 * `input_schema` used to be a hand-written object beside a handler that cast
 * `Record<string, unknown>` field by field, so nothing checked the model's
 * arguments against the shape the tool advertised. A wrong shape became
 * whatever the handler tripped over first — a Mongoose CastError, a
 * `Cannot read properties of undefined` — none of which name the offending
 * field, so the model could not correct itself and reissued the same call.
 *
 * Deriving the JSON Schema from the zod object closes both halves at once: one
 * description of the shape, and a parse that produces a field-level error
 * before the handler runs. The parse lives here rather than in `runTool` so it
 * covers every dispatch site, tests included.
 */
/**
 * `z.int()` emits JavaScript's safe-integer range as `minimum`/`maximum`. That
 * is true and useless: it advertises 9007199254740991 as a bound the model is
 * meant to respect, on fields whose real range is "a page size". Stripping it
 * leaves the bounds someone actually declared.
 */
function stripSafeIntegerBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) stripSafeIntegerBounds(item);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  if (record.maximum === Number.MAX_SAFE_INTEGER) delete record.maximum;
  if (record.minimum === Number.MIN_SAFE_INTEGER) delete record.minimum;
  for (const value of Object.values(record)) stripSafeIntegerBounds(value);
}

export function defineTool<T extends z.ZodObject>(
  spec: ToolSpec<T>,
): ToolDefinition {
  const derived = z.toJSONSchema(spec.input, { io: "input" });
  stripSafeIntegerBounds(derived);
  const { $schema, ...body } = derived as Record<string, unknown> & {
    $schema?: string;
  };

  const schema: ToolSchema = {
    name: spec.name,
    description: spec.description,
    input_schema: {
      ...body,
      type: "object",
      properties: (body.properties ??
        {}) as ToolSchema["input_schema"]["properties"],
      ...(Array.isArray(body.required) ? { required: body.required } : {}),
    },
  };

  const execute = spec.execute;

  return {
    schema,
    isWrite: spec.isWrite,
    category: spec.category,
    ...(spec.runtime ? { runtime: spec.runtime } : {}),
    ...(execute
      ? {
          execute: async (raw, context) => {
            const parsed = spec.input.safeParse(raw ?? {});
            if (!parsed.success) {
              throw new ToolInputError(
                spec.name,
                parsed.error.issues,
                describeInputIssues(spec.name, raw, parsed.error.issues),
              );
            }
            return execute(parsed.data as z.output<T>, context);
          },
        }
      : {}),
  };
}
