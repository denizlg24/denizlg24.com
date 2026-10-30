import { z } from "zod";

/**
 * Records a workspace page can point at: a mention, a record embed, a view
 * row. `page` is a workspace page; every other kind is a module's record.
 */
export const ENTITY_KINDS = [
  "page",
  "note",
  "kanban-board",
  "kanban-card",
  "whiteboard",
  "person",
  "course",
  "envelope",
  "paper",
  "voice-note",
  "latex-project",
  "calendar-event",
] as const;
export const entityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof entityKindSchema>;

const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `entity:<kind>:<id>`. */
export const entityRefSchema = z
  .string()
  .regex(new RegExp(`^entity:(${ENTITY_KINDS.join("|")}):[A-Za-z0-9_-]{1,64}$`))
  .describe("entity:<kind>:<id>, e.g. entity:note:6650f…");
export type EntityRef = z.infer<typeof entityRefSchema>;

export function entityRef(kind: EntityKind, id: string): EntityRef {
  return `entity:${kind}:${id}`;
}

export function parseEntityRef(
  ref: string,
): { kind: EntityKind; id: string } | null {
  const [prefix, kind, id, ...rest] = ref.split(":");
  if (prefix !== "entity" || rest.length > 0 || !id || !ENTITY_ID.test(id)) {
    return null;
  }
  const parsed = entityKindSchema.safeParse(kind);
  return parsed.success ? { kind: parsed.data, id } : null;
}

export const RECORD_EMBED_MODES = ["card", "full"] as const;
export const recordEmbedModeSchema = z.enum(RECORD_EMBED_MODES);
export type RecordEmbedMode = z.infer<typeof recordEmbedModeSchema>;

/** What a card, a mention and the record picker show for one record. */
export const recordSummarySchema = z.object({
  ref: entityRefSchema,
  kind: entityKindSchema,
  id: z.string(),
  title: z.string(),
  /** An emoji, when the record has one (pages). */
  icon: z.string().nullable().optional(),
  /** One line under the title: board, course, date. */
  subtitle: z.string().optional(),
  fields: z.array(z.object({ label: z.string(), value: z.string() })).max(6),
  updatedAt: z.string().optional(),
});
export type RecordSummary = z.infer<typeof recordSummarySchema>;

export const RECORD_REFS_MAX = 50;

export const recordsResponseSchema = z.object({
  records: z.array(recordSummarySchema),
  /** Refs that point at nothing: deleted, archived or never existed. */
  missing: z.array(z.string()),
});
export type RecordsResponse = z.infer<typeof recordsResponseSchema>;

export const recordSearchResponseSchema = z.object({
  records: z.array(recordSummarySchema),
});
