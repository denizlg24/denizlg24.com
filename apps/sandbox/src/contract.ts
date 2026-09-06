import { z } from "zod";

/**
 * The wire contract, written down before the implementation so the caller in
 * `apps/web/lib/sandbox.ts` can be pointed at this app without a second round
 * of shape negotiation. It reproduces what the eight agent tools already expect,
 * which is the current `@vercel/sandbox` surface minus everything unused.
 *
 * Bumped when a field changes meaning. `/healthz` reports it so a deploy that
 * rolled out behind its caller is visible rather than silently mismatched.
 */
export const SANDBOX_PROTOCOL_VERSION = 1;

/**
 * Sessions are keyed by conversation, exactly as `getSandbox(conversationId)`
 * is today: one long-lived box per conversation, reaped on idle, so a sequence
 * of tool calls in one turn sees the files the previous call wrote.
 */
export const createSessionSchema = z.object({
  conversationId: z.string().min(1),
  /** Wall-clock ceiling. A session outliving its turn is a leak, not a feature. */
  ttlSeconds: z.number().int().min(60).max(3600).default(900),
});

export const runCommandSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  timeoutMs: z.number().int().min(1000).max(600_000).default(120_000),
});

export const commandResultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  /** True when the command was killed by `timeoutMs` rather than exiting. */
  timedOut: z.boolean(),
});

export const writeFilesSchema = z.object({
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        /** Base64 so the same route carries text and binary without a branch. */
        contentBase64: z.string(),
      }),
    )
    .min(1),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type RunCommandInput = z.infer<typeof runCommandSchema>;
export type CommandResult = z.infer<typeof commandResultSchema>;
export type WriteFilesInput = z.infer<typeof writeFilesSchema>;
