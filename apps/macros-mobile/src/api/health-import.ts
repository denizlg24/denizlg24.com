import type {
  MacrosHealthImportTokenResponse,
  macrosHealthImportTokenBodySchema,
} from "@repo/schemas/macros";
import { useMutation } from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "@/lib/api";
import { API_URL } from "@/lib/config";

export type CreateHealthImportTokenInput = z.input<
  typeof macrosHealthImportTokenBodySchema
>;

/** Where a Shortcut POSTs weigh-ins and activity, bearing the token. */
export const HEALTH_IMPORT_WEBHOOK_URL = `${API_URL}/api/health-import/webhook`;

/**
 * The server stores only a hash, so the token in this mutation's result is
 * the one chance to read it. It is deliberately not cached anywhere.
 */
export function useCreateHealthImportToken() {
  return useMutation({
    // Fail at once when offline instead of pausing: a paused request would be
    // persisted and replayed later, minting a token nobody ever sees.
    networkMode: "always",
    mutationFn: (body: CreateHealthImportTokenInput) =>
      api<MacrosHealthImportTokenResponse>("/api/health-import/tokens", {
        method: "POST",
        body,
      }).then((response) => response.token),
  });
}
