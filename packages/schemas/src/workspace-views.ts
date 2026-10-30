import { z } from "zod";
import { agentTaskOriginSchema } from "./agent-tasks";
import { TRIAGE_CATEGORIES } from "./triage";
import { type EntityKind, entityRefSchema } from "./workspace-entities";

/*
 * A module view: a live query over one module's records, kept in a page as a
 * `view` block. Each source publishes a descriptor — its fields and their
 * types, the operators each type filters with, how a row becomes an entity
 * ref, which fields the database filters before the rows are read — and the
 * server's dispatcher (`POST /workspace/views/query`) reads rows for it; the
 * filtering, sorting, grouping and totals are one engine for every source
 * (`@repo/utils/workspace-views`).
 */

export const VIEW_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "boolean",
  "person",
  "money",
] as const;
export const viewFieldTypeSchema = z.enum(VIEW_FIELD_TYPES);
export type ViewFieldType = z.infer<typeof viewFieldTypeSchema>;

export const VIEW_FILTER_OPS = [
  "contains",
  "not_contains",
  "is",
  "is_not",
  "any_of",
  "none_of",
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "on",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "past_days",
  "next_days",
  "empty",
  "not_empty",
] as const;
export const viewFilterOpSchema = z.enum(VIEW_FILTER_OPS);
export type ViewFilterOp = z.infer<typeof viewFilterOpSchema>;

const NUMERIC_OPS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "empty",
  "not_empty",
] as const satisfies readonly ViewFilterOp[];

/**
 * What each field type filters with. Money compares `amountMinor` in the
 * row's own currency; date operands are `YYYY-MM-DD`, `past_days` and
 * `next_days` take a day count; select `is` on a multi-value field means
 * "has this value".
 */
export const VIEW_FILTER_OPS_BY_TYPE: Record<
  ViewFieldType,
  readonly ViewFilterOp[]
> = {
  text: ["contains", "not_contains", "is", "is_not", "empty", "not_empty"],
  number: NUMERIC_OPS,
  money: NUMERIC_OPS,
  date: [
    "on",
    "before",
    "after",
    "on_or_before",
    "on_or_after",
    "past_days",
    "next_days",
    "empty",
    "not_empty",
  ],
  select: ["is", "is_not", "any_of", "none_of", "empty", "not_empty"],
  boolean: ["is"],
  person: ["is", "is_not", "empty", "not_empty"],
};

/** Operators that take no operand. */
export const VIEW_UNARY_OPS: readonly ViewFilterOp[] = ["empty", "not_empty"];

export const VIEW_SOURCE_IDS = [
  "kanban-cards",
  "calendar-events",
  "notes",
  "finance-entries",
  "course-assignments",
  "people",
  "triage",
  "agent-tasks",
  "papers",
  "voice-notes",
] as const;
export const viewSourceIdSchema = z.enum(VIEW_SOURCE_IDS);
export type ViewSourceId = z.infer<typeof viewSourceIdSchema>;

export const VIEW_LAYOUTS = [
  "table",
  "list",
  "board",
  "calendar",
  "gallery",
] as const;
export const viewLayoutSchema = z.enum(VIEW_LAYOUTS);
export type ViewLayout = z.infer<typeof viewLayoutSchema>;

const fieldKeySchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/);

export const viewFilterValueSchema = z.union([
  z.string().max(200),
  z.number(),
  z.boolean(),
  z.array(z.string().max(200)).max(50),
]);
export type ViewFilterValue = z.infer<typeof viewFilterValueSchema>;

export const viewFilterSchema = z.object({
  field: fieldKeySchema,
  op: viewFilterOpSchema,
  /** Absent for `empty` / `not_empty`. */
  value: viewFilterValueSchema.optional(),
});
export type ViewFilter = z.infer<typeof viewFilterSchema>;

export const viewSortSchema = z.object({
  field: fieldKeySchema,
  dir: z.enum(["asc", "desc"]),
});
export type ViewSort = z.infer<typeof viewSortSchema>;

export const VIEW_LIMIT_MAX = 200;
export const VIEW_FILTERS_MAX = 12;

/** What a `view` block stores: the query and how to lay it out. */
export const viewConfigSchema = z.object({
  source: viewSourceIdSchema,
  layout: viewLayoutSchema.default("table"),
  /** All must hold. */
  filters: z.array(viewFilterSchema).max(VIEW_FILTERS_MAX).default([]),
  /** First key first; the source's default order breaks ties. */
  sort: z.array(viewSortSchema).max(3).default([]),
  /** A select, boolean or person field; the board's columns. */
  group: fieldKeySchema.optional(),
  /** Rows per page of results. */
  limit: z.number().int().min(1).max(VIEW_LIMIT_MAX).default(25),
  /** Columns shown, in order; absent shows the source's defaults. */
  fields: z.array(fieldKeySchema).max(20).optional(),
  /** The date field the calendar lays rows out by; absent is the source's first. */
  dateField: fieldKeySchema.optional(),
});
export type ViewConfig = z.infer<typeof viewConfigSchema>;
export type ViewConfigInput = z.input<typeof viewConfigSchema>;

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

export interface ViewFieldDef {
  label: string;
  type: ViewFieldType;
  /** Fixed choices; a select without them learns its options from the rows. */
  options?: readonly string[];
  /** A select or person field holding several values (labels, tags). */
  multiple?: boolean;
}

export interface ViewSourceDescriptor {
  id: ViewSourceId;
  label: string;
  /** The field shown as a row's title. */
  titleField: string;
  fields: Record<string, ViewFieldDef>;
  defaultFields: readonly string[];
  defaultSort: ViewSort;
  /** The board layout's grouping when the view names none. */
  defaultGroup?: string;
  /**
   * How a row becomes an entity ref: the record itself (`via: "id"`) or a
   * record it belongs to, named by a field the server reads. Null when the
   * module has no embeddable record.
   */
  entity: { kind: EntityKind; via: "id" | "course" } | null;
  /**
   * How rows are read: every source goes through the generic query route;
   * `native` names the fields the database filters before rows are read
   * (the rest is filtered over at most `VIEW_SCAN_CAP` rows).
   */
  fetch: { route: "workspace/views/query"; native: readonly string[] };
}

const PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
const ROUTE = "workspace/views/query" as const;

export const VIEW_SOURCES: Record<ViewSourceId, ViewSourceDescriptor> = {
  "kanban-cards": {
    id: "kanban-cards",
    label: "Kanban cards",
    titleField: "title",
    fields: {
      title: { label: "Title", type: "text" },
      board: { label: "Board", type: "select" },
      column: { label: "Column", type: "select" },
      done: { label: "Done", type: "boolean" },
      priority: { label: "Priority", type: "select", options: PRIORITIES },
      labels: { label: "Labels", type: "select", multiple: true },
      due: { label: "Due", type: "date" },
      start: { label: "Start", type: "date" },
      people: { label: "People", type: "person", multiple: true },
      updated: { label: "Updated", type: "date" },
    },
    defaultFields: ["title", "board", "column", "due", "priority"],
    defaultSort: { field: "due", dir: "asc" },
    defaultGroup: "column",
    entity: { kind: "kanban-card", via: "id" },
    fetch: { route: ROUTE, native: ["board", "due"] },
  },
  "calendar-events": {
    id: "calendar-events",
    label: "Calendar events",
    titleField: "title",
    fields: {
      title: { label: "Title", type: "text" },
      date: { label: "Date", type: "date" },
      end: { label: "End", type: "date" },
      allDay: { label: "All day", type: "boolean" },
      kind: {
        label: "Kind",
        type: "select",
        options: ["manual", "meeting", "flight", "holiday", "birthday"],
      },
      status: {
        label: "Status",
        type: "select",
        options: ["scheduled", "completed", "canceled"],
      },
      place: { label: "Place", type: "text" },
    },
    defaultFields: ["title", "date", "place", "kind"],
    defaultSort: { field: "date", dir: "asc" },
    defaultGroup: "kind",
    entity: { kind: "calendar-event", via: "id" },
    fetch: { route: ROUTE, native: ["date", "kind", "status"] },
  },
  notes: {
    id: "notes",
    label: "Notes",
    titleField: "title",
    fields: {
      title: { label: "Title", type: "text" },
      tags: { label: "Tags", type: "select", multiple: true },
      class: { label: "Class", type: "select" },
      status: {
        label: "Status",
        type: "select",
        options: ["open", "archived"],
      },
      url: { label: "URL", type: "text" },
      created: { label: "Created", type: "date" },
      updated: { label: "Updated", type: "date" },
    },
    defaultFields: ["title", "tags", "updated"],
    defaultSort: { field: "updated", dir: "desc" },
    defaultGroup: "class",
    entity: { kind: "note", via: "id" },
    fetch: { route: ROUTE, native: ["status", "tags"] },
  },
  "finance-entries": {
    id: "finance-entries",
    label: "Finance entries",
    titleField: "description",
    fields: {
      description: { label: "Description", type: "text" },
      amount: { label: "Amount", type: "money" },
      currency: { label: "Currency", type: "select" },
      date: { label: "Date", type: "date" },
      category: { label: "Category", type: "select" },
      account: { label: "Account", type: "select" },
      origin: {
        label: "Origin",
        type: "select",
        options: ["bank", "manual", "projected"],
      },
      state: {
        label: "State",
        type: "select",
        options: [
          "pending",
          "booked",
          "active",
          "expected",
          "linked",
          "missed",
          "void",
        ],
      },
      note: { label: "Note", type: "text" },
    },
    defaultFields: ["date", "description", "category", "amount"],
    defaultSort: { field: "date", dir: "desc" },
    defaultGroup: "category",
    entity: null,
    fetch: { route: ROUTE, native: ["date", "currency", "origin", "state"] },
  },
  "course-assignments": {
    id: "course-assignments",
    label: "Course assignments",
    titleField: "title",
    fields: {
      title: { label: "Title", type: "text" },
      course: { label: "Course", type: "select" },
      type: {
        label: "Type",
        type: "select",
        options: ["assignment", "exam", "quiz", "project", "lab", "reading"],
      },
      status: {
        label: "Status",
        type: "select",
        options: ["planned", "in-progress", "submitted", "graded", "archived"],
      },
      assessed: { label: "Assessed", type: "boolean" },
      due: { label: "Due", type: "date" },
      submitted: { label: "Submitted", type: "date" },
      score: { label: "Score", type: "number" },
      weight: { label: "Weight", type: "number" },
    },
    defaultFields: ["title", "course", "type", "due", "status"],
    defaultSort: { field: "due", dir: "asc" },
    defaultGroup: "status",
    entity: { kind: "course", via: "course" },
    fetch: { route: ROUTE, native: ["due", "status", "type"] },
  },
  people: {
    id: "people",
    label: "People",
    titleField: "name",
    fields: {
      name: { label: "Name", type: "text" },
      birthday: { label: "Next birthday", type: "date" },
      placeMet: { label: "Met at", type: "text" },
      email: { label: "Email", type: "text" },
      phone: { label: "Phone", type: "text" },
      groups: { label: "Groups", type: "select", multiple: true },
      updated: { label: "Updated", type: "date" },
    },
    defaultFields: ["name", "groups", "birthday", "email"],
    defaultSort: { field: "name", dir: "asc" },
    defaultGroup: "groups",
    entity: { kind: "person", via: "id" },
    fetch: { route: ROUTE, native: [] },
  },
  triage: {
    id: "triage",
    label: "Triage",
    titleField: "subject",
    fields: {
      subject: { label: "Subject", type: "text" },
      from: { label: "From", type: "text" },
      category: {
        label: "Category",
        type: "select",
        options: TRIAGE_CATEGORIES,
      },
      status: {
        label: "Status",
        type: "select",
        options: ["pending", "reviewed", "archived"],
      },
      review: { label: "Needs review", type: "boolean" },
      course: { label: "Course", type: "select" },
      summary: { label: "Summary", type: "text" },
      received: { label: "Received", type: "date" },
      tasks: { label: "Suggested tasks", type: "number" },
    },
    defaultFields: ["received", "subject", "from", "category"],
    defaultSort: { field: "received", dir: "desc" },
    defaultGroup: "category",
    entity: null,
    fetch: { route: ROUTE, native: ["received", "category", "status"] },
  },
  "agent-tasks": {
    id: "agent-tasks",
    label: "Agent tasks",
    titleField: "name",
    fields: {
      name: { label: "Name", type: "text" },
      status: {
        label: "Status",
        type: "select",
        options: ["active", "paused", "archived"],
      },
      origin: {
        label: "Origin",
        type: "select",
        options: agentTaskOriginSchema.options,
      },
      schedule: { label: "Schedule", type: "text" },
      model: { label: "Model", type: "select" },
      nextRun: { label: "Next run", type: "date" },
      lastRun: { label: "Last run", type: "date" },
    },
    defaultFields: ["name", "status", "schedule", "nextRun"],
    defaultSort: { field: "nextRun", dir: "asc" },
    defaultGroup: "status",
    entity: null,
    fetch: { route: ROUTE, native: ["status"] },
  },
  papers: {
    id: "papers",
    label: "Papers",
    titleField: "title",
    fields: {
      title: { label: "Title", type: "text" },
      authors: { label: "Authors", type: "text" },
      year: { label: "Year", type: "number" },
      type: {
        label: "Type",
        type: "select",
        options: [
          "article",
          "conference",
          "preprint",
          "thesis",
          "book",
          "chapter",
          "report",
          "notes",
          "slides",
          "dataset",
          "other",
        ],
      },
      reading: {
        label: "Reading",
        type: "select",
        options: ["unread", "reading", "read"],
      },
      venue: { label: "Venue", type: "text" },
      added: { label: "Added", type: "date" },
    },
    defaultFields: ["title", "authors", "year", "reading"],
    defaultSort: { field: "added", dir: "desc" },
    defaultGroup: "reading",
    entity: { kind: "paper", via: "id" },
    fetch: { route: ROUTE, native: ["reading", "type"] },
  },
  "voice-notes": {
    id: "voice-notes",
    label: "Voice notes",
    titleField: "title",
    fields: {
      title: { label: "Title", type: "text" },
      recorded: { label: "Recorded", type: "date" },
      minutes: { label: "Minutes", type: "number" },
      source: {
        label: "Source",
        type: "select",
        options: ["recording", "upload", "agent"],
      },
      tags: { label: "Tags", type: "select", multiple: true },
      transcript: {
        label: "Transcript",
        type: "select",
        options: [
          "untranscribed",
          "queued",
          "transcribing",
          "transcribed",
          "failed",
        ],
      },
    },
    defaultFields: ["title", "recorded", "minutes", "tags"],
    defaultSort: { field: "recorded", dir: "desc" },
    defaultGroup: "source",
    entity: { kind: "voice-note", via: "id" },
    fetch: { route: ROUTE, native: ["recorded"] },
  },
};

/** Rows a source reads before filtering in memory; past it the answer says `truncated`. */
export const VIEW_SCAN_CAP = 2000;

/** A date field to lay a calendar out by. */
export function viewDateField(
  descriptor: ViewSourceDescriptor,
  config: Pick<ViewConfig, "dateField">,
): string | null {
  if (
    config.dateField &&
    descriptor.fields[config.dateField]?.type === "date"
  ) {
    return config.dateField;
  }
  return (
    Object.entries(descriptor.fields).find(
      ([, def]) => def.type === "date",
    )?.[0] ?? null
  );
}

/** The field a board groups by: the view's own, else the source's default. */
export function viewGroupField(
  descriptor: ViewSourceDescriptor,
  config: Pick<ViewConfig, "group">,
): string | null {
  const key = config.group ?? descriptor.defaultGroup;
  if (!key) return null;
  const type = descriptor.fields[key]?.type;
  return type === "select" || type === "boolean" || type === "person"
    ? key
    : null;
}

// ---------------------------------------------------------------------------
// Rows and the query
// ---------------------------------------------------------------------------

export const viewMoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type ViewMoney = z.infer<typeof viewMoneySchema>;

export const viewPersonSchema = z.object({ id: z.string(), name: z.string() });
export type ViewPerson = z.infer<typeof viewPersonSchema>;

/** Dates are ISO strings (`YYYY-MM-DD` for all-day values). */
export const viewValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  viewMoneySchema,
  z.array(z.string()),
  z.array(viewPersonSchema),
]);
export type ViewValue = z.infer<typeof viewValueSchema>;

export const viewRowSchema = z.object({
  id: z.string(),
  /** What clicking the row opens; null when the module has no embeddable record. */
  ref: entityRefSchema.nullable(),
  values: z.record(z.string(), viewValueSchema),
});
export type ViewRow = z.infer<typeof viewRowSchema>;

export const viewTotalSchema = z.object({
  field: z.string(),
  currency: z.string(),
  amountMinor: z.number().int(),
});
export type ViewTotal = z.infer<typeof viewTotalSchema>;

export const viewGroupSchema = z.object({
  /** "" is rows with no value. */
  key: z.string(),
  count: z.number().int(),
  /** Per money field and currency; never summed across currencies. */
  totals: z.array(viewTotalSchema),
});
export type ViewGroup = z.infer<typeof viewGroupSchema>;

export const viewQueryResultSchema = z.object({
  source: viewSourceIdSchema,
  rows: z.array(viewRowSchema),
  /** Rows matching the filters, across every page. */
  total: z.number().int(),
  /** Rows the source read before filtering. */
  scanned: z.number().int(),
  /** The source had more rows than it reads; the answer covers the newest. */
  truncated: z.boolean(),
  nextCursor: z.string().nullable(),
  /** Over every matching row, in board order; empty when the view has no group. */
  groups: z.array(viewGroupSchema),
  totals: z.array(viewTotalSchema),
  /** Values seen per select field, for filter pickers (at most 50 each). */
  options: z.record(z.string(), z.array(z.string())),
});
export type ViewQueryResult = z.infer<typeof viewQueryResultSchema>;

export const viewQueryRequestSchema = z
  .object({
    view: viewConfigSchema.optional(),
    /** With blockId: run the view block stored on that page. */
    pageId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    blockId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
    /** Overrides the view's own page size (MCP reads fewer). */
    limit: z.number().int().min(1).max(VIEW_LIMIT_MAX).optional(),
    cursor: z
      .string()
      .regex(/^\d{1,6}$/)
      .optional(),
    /** The caller's local date, for relative date filters; absent is UTC today. */
    today: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine(
    (body) =>
      (body.view !== undefined) !==
      (body.pageId !== undefined && body.blockId !== undefined),
    { message: "Either view, or pageId and blockId" },
  );
export type ViewQueryRequest = z.input<typeof viewQueryRequestSchema>;
