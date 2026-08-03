import { z } from "zod";
import { isoDateTimeSchema, tickerSchema } from "./common";
import { quoteSchema } from "./market-data";

/**
 * Wire contract between the browser and apps/markets-relay. Both sides parse
 * with these, so a relay deployed from a different commit fails loudly instead
 * of feeding the chart nonsense.
 */

export const RELAY_MAX_SYMBOLS = 200;

/** No client can ever want more than the relay will hold, so an oversized frame
 * is rejected at the schema boundary rather than after the server has iterated
 * and inserted every ticker in it. */
const relayTickersSchema = z.array(tickerSchema).max(RELAY_MAX_SYMBOLS);

export const relayClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), tickers: relayTickersSchema }),
  z.object({ type: z.literal("unsubscribe"), tickers: relayTickersSchema }),
  z.object({ type: z.literal("ping") }),
]);
export type RelayClientMessage = z.infer<typeof relayClientMessageSchema>;

export const relayErrorCodeSchema = z.enum([
  "unauthorized",
  "bad_request",
  "upstream_unavailable",
  "budget_exhausted",
  "too_many_symbols",
]);
export type RelayErrorCode = z.infer<typeof relayErrorCodeSchema>;

export const relayServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    tickers: z.array(tickerSchema),
    upstream: z.enum(["connected", "connecting", "disconnected"]),
  }),
  z.object({ type: z.literal("quotes"), quotes: z.array(quoteSchema) }),
  z.object({ type: z.literal("pong"), ts: isoDateTimeSchema }),
  z.object({
    type: z.literal("error"),
    code: relayErrorCodeSchema,
    message: z.string(),
  }),
]);
export type RelayServerMessage = z.infer<typeof relayServerMessageSchema>;

export const relayTokenClaimsSchema = z.object({
  /** Seconds since epoch. Kept short; the client refreshes before reconnecting. */
  exp: z.number().int().positive(),
  nonce: z.string().min(8),
});
export type RelayTokenClaims = z.infer<typeof relayTokenClaimsSchema>;

export const relayTokenResponseSchema = z.object({
  token: z.string().min(1),
  url: z.string().min(1),
  expiresAt: isoDateTimeSchema,
});
export type RelayTokenResponse = z.infer<typeof relayTokenResponseSchema>;

/**
 * Cloudflare closes an idle WebSocket after 100 s and Tiingo goes silent
 * outside market hours, so both hops heartbeat well inside that window.
 */
export const RELAY_HEARTBEAT_MS = 30_000;
export const RELAY_IDLE_TIMEOUT_MS = 90_000;
