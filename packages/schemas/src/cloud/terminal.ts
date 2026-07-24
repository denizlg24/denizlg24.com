import { z } from "zod";

export const TERMINAL_TICKET_AUDIENCE = "cloud-terminal";
export const TERMINAL_TICKET_TTL_SECONDS = 30;
export const TERMINAL_SESSION_PREFIX = "cloud-";

export const terminalSessionIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const terminalTicketClaimsSchema = z.object({
  aud: z.literal(TERMINAL_TICKET_AUDIENCE),
  exp: z.number().int().positive(),
  iat: z.number().int().nonnegative(),
  jti: z.uuid(),
  sid: terminalSessionIdSchema.optional(),
  sub: z.string().min(1).max(128),
});

export const mintTerminalTicketInputSchema = z
  .object({
    sessionId: terminalSessionIdSchema.optional(),
  })
  .default({});

export const terminalTicketResponseSchema = z.object({
  data: z.object({
    expiresAt: z.iso.datetime(),
    sessionId: terminalSessionIdSchema,
    ticket: z.string().min(1),
  }),
});

export const terminalSessionSchema = z.object({
  attachedClients: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  id: terminalSessionIdSchema,
  lastActivityAt: z.iso.datetime(),
});

export const terminalSessionsResponseSchema = z.object({
  data: z.array(terminalSessionSchema),
});

export const terminalClientControlFrameSchema = z.discriminatedUnion("t", [
  z.object({
    t: z.literal("resize"),
    cols: z.number().int().min(20).max(500),
    rows: z.number().int().min(5).max(200),
  }),
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("pong") }),
  z.object({ t: z.literal("sessions") }),
  z.object({
    t: z.literal("attach"),
    id: terminalSessionIdSchema,
  }),
]);

export const terminalServerControlFrameSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ping") }),
  z.object({ t: z.literal("pong") }),
  z.object({
    t: z.literal("sessions"),
    sessions: z.array(terminalSessionSchema),
  }),
]);

export type TerminalClientControlFrame = z.infer<
  typeof terminalClientControlFrameSchema
>;
export type TerminalServerControlFrame = z.infer<
  typeof terminalServerControlFrameSchema
>;
export type TerminalSession = z.infer<typeof terminalSessionSchema>;
export type TerminalTicketClaims = z.infer<typeof terminalTicketClaimsSchema>;
