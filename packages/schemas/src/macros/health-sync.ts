import { z } from "zod";

/**
 * `POST /api/health-sync` takes `macrosHealthImportBodySchema`, the same body
 * the Shortcuts webhook does, under the session instead of a token.
 */
export const macrosHealthSyncResultSchema = z.object({
  weighInsCreated: z.number().int().nonnegative(),
  activitiesUpserted: z.number().int().nonnegative(),
});

export type MacrosHealthSyncResult = z.infer<
  typeof macrosHealthSyncResultSchema
>;
