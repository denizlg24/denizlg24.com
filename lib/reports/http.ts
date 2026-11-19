import "server-only";
import { z } from "zod";
import { deckInputSchema, reportInputSchema } from "./types";

const maxBody = 1_500_000;

export async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBody)
    throw new BodyError("The document is too large.", 413);
  const raw = await request.text().catch(() => "");
  if (raw.length > maxBody)
    throw new BodyError("The document is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new BodyError("Invalid request body.", 400);
  }
}

export class BodyError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export const createSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("report"),
    doc: reportInputSchema,
    share: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("deck"),
    doc: deckInputSchema,
    share: z.boolean().optional(),
  }),
]);

export const issue = (error: z.ZodError) => {
  const first = error.issues[0];
  return first
    ? `${first.path.join(".") || "body"}: ${first.message}`
    : "Invalid document.";
};

export const message = (error: unknown, fallback: string) =>
  error instanceof Error && error.message.length < 400
    ? error.message
    : fallback;
