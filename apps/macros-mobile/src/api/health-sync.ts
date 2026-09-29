import type {
  MacrosHealthSyncResult,
  macrosHealthImportBodySchema,
} from "@repo/schemas/macros";
import type { z } from "zod";
import { api } from "@/lib/api";

export type HealthSyncInput = z.input<typeof macrosHealthImportBodySchema>;

export function postHealthSync(body: HealthSyncInput) {
  return api<MacrosHealthSyncResult>("/api/health-sync", {
    method: "POST",
    body,
  });
}
