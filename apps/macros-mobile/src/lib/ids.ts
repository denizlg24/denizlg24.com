import { randomUUID } from "expo-crypto";

/**
 * Idempotency key for a log write. Created once per user action and kept
 * across retries, so a request that reached the server but lost its response
 * cannot log the same food twice when it is replayed.
 */
export function newClientMutationId(): string {
  return randomUUID();
}
