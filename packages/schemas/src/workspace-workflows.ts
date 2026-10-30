import { z } from "zod";
import { agentTaskScheduleSchema } from "./agent-tasks";

/*
 * Workflows over the workspace: templates, button actions, event triggers.
 * Block shapes that carry these (button, agent section) live in `workspace`;
 * this file holds what they reference, and nothing here imports blocks.
 */

const pageIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Workspace page id");
const blockIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Block id");

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * Variables a template may use, as `{{name}}`. `date`, `time`, `week` and
 * `weekday` are read in the app's time zone when the template is used;
 * `page.title` is the title of the page the blocks land in. A prompted input
 * is `{{input:Name}}`, asked once per instantiation.
 */
export const TEMPLATE_VARIABLES = [
  "date",
  "time",
  "week",
  "weekday",
  "page.title",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const TEMPLATE_INPUT_NAME_MAX = 60;

export const templateInputsSchema = z
  .record(z.string().min(1).max(TEMPLATE_INPUT_NAME_MAX), z.string().max(2_000))
  .refine((inputs) => Object.keys(inputs).length <= 20, {
    message: "At most 20 inputs",
  })
  .describe("Values for the template's {{input:Name}} prompts, by name");
export type TemplateInputs = z.infer<typeof templateInputsSchema>;

export const workspaceTemplateSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().nullable(),
  /** Names of its `{{input:Name}}` prompts, in first-seen order. */
  inputs: z.array(z.string()),
  blockCount: z.number().int().min(0),
  updatedAt: z.string(),
});
export type WorkspaceTemplateSummary = z.infer<
  typeof workspaceTemplateSummarySchema
>;

/** A new page from a template. */
export const templateInstantiateSchema = z.object({
  parentId: pageIdSchema
    .nullable()
    .default(null)
    .describe("Parent page id; null is the top level"),
  /** Overrides the template's own title; variables apply to it too. */
  title: z.string().max(500).optional(),
  inputs: templateInputsSchema.default({}),
  index: z.number().int().min(0).optional(),
});
export type TemplateInstantiate = z.input<typeof templateInstantiateSchema>;

/** A template's blocks inserted into an existing page. */
export const templateInsertSchema = z.object({
  pageId: pageIdSchema,
  parentId: blockIdSchema
    .nullable()
    .optional()
    .describe("Container block to insert into; absent is the page root"),
  after: blockIdSchema
    .nullable()
    .optional()
    .describe("Insert after this sibling; null is first, absent is last"),
  inputs: templateInputsSchema.default({}),
});
export type TemplateInsert = z.input<typeof templateInsertSchema>;

/** Blocks of one page copied into a new template page. */
export const templateFromBlocksSchema = z.object({
  pageId: pageIdSchema,
  blockIds: z.array(blockIdSchema).min(1).max(200),
  title: z.string().max(500).default(""),
});
export type TemplateFromBlocks = z.input<typeof templateFromBlocksSchema>;

// ---------------------------------------------------------------------------
// Actions: what a button (and a trigger) does
// ---------------------------------------------------------------------------

/** "The page holding the button"; a trigger has none, and an action naming it fails. */
export const THIS_PAGE = "$this";

const pageTargetSchema = z
  .union([z.literal(THIS_PAGE), pageIdSchema])
  .describe("A page id, or $this for the page holding the button");
const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/);

/**
 * One step of a button or trigger. Text fields may hold template variables
 * (`{{date}}`, `{{input:Name}}`, and in a trigger `{{event.<field>}}`), filled
 * when the action runs.
 */
export const workflowActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create-page"),
    templateId: pageIdSchema,
    parentId: pageTargetSchema
      .nullable()
      .default(null)
      .describe("Parent page; null is the top level"),
    title: z.string().max(500).optional(),
    inputs: templateInputsSchema.default({}),
  }),
  z.object({
    kind: z.literal("append-blocks"),
    pageId: pageTargetSchema.default(THIS_PAGE),
    /** Workspace markdown, appended at the end of the page. */
    markdown: z.string().min(1).max(20_000),
  }),
  z.object({
    kind: z.literal("insert-template"),
    templateId: pageIdSchema,
    inputs: templateInputsSchema.default({}),
  }),
  z.object({
    kind: z.literal("create-card"),
    boardId: objectIdSchema,
    columnId: objectIdSchema,
    title: z.string().min(1).max(300),
    description: z.string().max(5_000).optional(),
    /** `YYYY-MM-DD` once variables are filled. */
    dueDate: z.string().max(60).optional(),
  }),
  z.object({
    kind: z.literal("create-event"),
    title: z.string().min(1).max(300),
    /** `YYYY-MM-DD` once variables are filled. */
    date: z.string().min(1).max(60),
    /** `HH:MM` local; absent is an all-day event. */
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .optional(),
    durationMinutes: z.number().int().min(5).max(1_440).default(60),
    place: z.string().max(300).optional(),
  }),
  z.object({
    kind: z.literal("set-todo"),
    pageId: pageTargetSchema.default(THIS_PAGE),
    blockId: blockIdSchema,
    checked: z.boolean(),
  }),
  z.object({
    kind: z.literal("open"),
    /** A URL, or an app path starting with `/`; only a person's click opens it. */
    url: z.string().min(1).max(2_048),
  }),
]);
export type WorkflowAction = z.infer<typeof workflowActionSchema>;
export type WorkflowActionInput = z.input<typeof workflowActionSchema>;
export type WorkflowActionKind = WorkflowAction["kind"];
export const WORKFLOW_ACTION_KINDS = [
  "create-page",
  "append-blocks",
  "insert-template",
  "create-card",
  "create-event",
  "set-todo",
  "open",
] as const satisfies readonly WorkflowActionKind[];
// Every kind is listed.
const _everyActionKind: readonly (typeof WORKFLOW_ACTION_KINDS)[number][] =
  workflowActionSchema.options.map((option) => option.shape.kind.value);
void _everyActionKind;

export const WORKFLOW_ACTIONS_MAX = 10;
export const workflowActionsSchema = z
  .array(workflowActionSchema)
  .max(WORKFLOW_ACTIONS_MAX);

/** What one action did; actions run in order and a failure does not stop the next. */
export const workflowActionResultSchema = z.object({
  index: z.number().int().min(0),
  kind: z.enum(WORKFLOW_ACTION_KINDS),
  ok: z.boolean(),
  /** A refused or failed action's reason. */
  error: z.string().optional(),
  /** Not run: `open` without a person to open it for. */
  skipped: z.boolean().optional(),
  pageId: z.string().optional(),
  blockIds: z.array(z.string()).optional(),
  cardId: z.string().optional(),
  eventId: z.string().optional(),
  url: z.string().optional(),
});
export type WorkflowActionResult = z.infer<typeof workflowActionResultSchema>;

export const BUTTON_MODES = ["actions", "agent"] as const;
export const buttonModeSchema = z.enum(BUTTON_MODES);
export type ButtonMode = z.infer<typeof buttonModeSchema>;

/** Presses the button block `blockId` on page `pageId`. */
export const buttonRunRequestSchema = z.object({
  pageId: pageIdSchema,
  blockId: blockIdSchema,
});
export type ButtonRunRequest = z.infer<typeof buttonRunRequestSchema>;

export const agentRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type AgentRunStatus = z.infer<typeof agentRunStatusSchema>;

/** The background run a button started, as the block shows it. */
export const buttonAgentRunSchema = z.object({
  runId: z.string(),
  conversationId: z.string(),
  status: agentRunStatusSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
  error: z.string().optional(),
});
export type ButtonAgentRun = z.infer<typeof buttonAgentRunSchema>;

export const buttonRunResponseSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("actions"),
    results: z.array(workflowActionResultSchema),
  }),
  z.object({ mode: z.literal("agent"), run: buttonAgentRunSchema }),
]);
export type ButtonRunResponse = z.infer<typeof buttonRunResponseSchema>;

// ---------------------------------------------------------------------------
// Domain events and triggers
// ---------------------------------------------------------------------------

export type EventFieldType = "string" | "number" | "boolean";

/**
 * Every domain event web emits and the fields of its payload. A trigger's
 * filter names these fields, typed, and its actions read them as
 * `{{event.<field>}}`.
 */
export const DOMAIN_EVENT_FIELDS = {
  "kanban.card.created": {
    cardId: "string",
    boardId: "string",
    boardTitle: "string",
    columnId: "string",
    columnTitle: "string",
    title: "string",
    done: "boolean",
  },
  "kanban.card.moved": {
    cardId: "string",
    boardId: "string",
    boardTitle: "string",
    title: "string",
    fromColumnId: "string",
    fromColumnTitle: "string",
    toColumnId: "string",
    toColumnTitle: "string",
    done: "boolean",
  },
  "calendar.event.created": {
    eventId: "string",
    title: "string",
    date: "string",
    allDay: "boolean",
  },
  "email.triaged": {
    triageId: "string",
    emailId: "string",
    subject: "string",
    from: "string",
    category: "string",
    confidence: "number",
    reviewRequired: "boolean",
  },
  "finance.payout.landed": {
    ruleId: "string",
    ruleName: "string",
    ledgerId: "string",
    amountMinor: "number",
    currency: "string",
    date: "string",
    method: "string",
  },
  "voice-note.transcribed": {
    voiceNoteId: "string",
    title: "string",
    durationMs: "number",
    characters: "number",
  },
  "workspace.page.created": {
    pageId: "string",
    title: "string",
    parentId: "string",
    actor: "string",
  },
  "schedule.tick": {
    triggerId: "string",
    scheduledFor: "string",
  },
} as const satisfies Record<string, Record<string, EventFieldType>>;

export type DomainEventType = keyof typeof DOMAIN_EVENT_FIELDS;
export const DOMAIN_EVENT_TYPES = Object.keys(
  DOMAIN_EVENT_FIELDS,
) as DomainEventType[];
export const domainEventTypeSchema = z.enum(
  DOMAIN_EVENT_TYPES as [DomainEventType, ...DomainEventType[]],
);

type FieldValue<T extends EventFieldType> = T extends "number"
  ? number
  : T extends "boolean"
    ? boolean
    : string;
export type DomainEventPayload<T extends DomainEventType> = {
  [K in keyof (typeof DOMAIN_EVENT_FIELDS)[T]]: FieldValue<
    (typeof DOMAIN_EVENT_FIELDS)[T][K] & EventFieldType
  >;
};
export type DomainEvent = {
  [T in DomainEventType]: { type: T; payload: DomainEventPayload<T> };
}[DomainEventType];

const fieldSchema = (type: EventFieldType) =>
  type === "number"
    ? z.number()
    : type === "boolean"
      ? z.boolean()
      : z.string().max(2_000);

function payloadSchema(type: DomainEventType) {
  return z.object(
    Object.fromEntries(
      Object.entries(DOMAIN_EVENT_FIELDS[type]).map(([name, kind]) => [
        name,
        fieldSchema(kind),
      ]),
    ),
  );
}

/** Validates an event's payload against its type's fields. */
export function parseDomainEvent(value: {
  type: string;
  payload: unknown;
}): DomainEvent | null {
  const type = domainEventTypeSchema.safeParse(value.type);
  if (!type.success) return null;
  const payload = payloadSchema(type.data).safeParse(value.payload);
  if (!payload.success) return null;
  // The schema was built from this type's field table, so the payload has its shape.
  const event = { type: type.data, payload: payload.data };
  return isDomainEvent(event) ? event : null;
}

function isDomainEvent(event: {
  type: DomainEventType;
  payload: Record<string, unknown>;
}): event is DomainEvent {
  return Object.entries(DOMAIN_EVENT_FIELDS[event.type]).every(
    ([name, kind]) => typeof event.payload[name] === kind,
  );
}

export const TRIGGER_FILTER_OPS = [
  "eq",
  "neq",
  "contains",
  "not_contains",
  "gt",
  "gte",
  "lt",
  "lte",
] as const;
export const triggerFilterOpSchema = z.enum(TRIGGER_FILTER_OPS);
export type TriggerFilterOp = z.infer<typeof triggerFilterOpSchema>;

export const TRIGGER_OPS_BY_TYPE: Record<EventFieldType, TriggerFilterOp[]> = {
  string: ["eq", "neq", "contains", "not_contains"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte"],
  boolean: ["eq", "neq"],
};

export const triggerConditionSchema = z.object({
  field: z.string().min(1).max(60),
  op: triggerFilterOpSchema,
  value: z.union([z.string().max(500), z.number(), z.boolean()]),
});
export type TriggerCondition = z.infer<typeof triggerConditionSchema>;

export const TRIGGER_CONDITIONS_MAX = 10;
/** Conditions ANDed; empty matches every event of the type. */
export const triggerFilterSchema = z
  .array(triggerConditionSchema)
  .max(TRIGGER_CONDITIONS_MAX);
export type TriggerFilter = z.infer<typeof triggerFilterSchema>;

export const triggerActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("actions"),
    actions: workflowActionsSchema.min(1),
  }),
  z.object({
    kind: z.literal("agent"),
    /** Run as an incognito background agent run with the event as context. */
    prompt: z.string().trim().min(1).max(8_000),
  }),
]);
export type TriggerAction = z.infer<typeof triggerActionSchema>;

/** Consecutive failed firings after which a trigger turns itself off. */
export const TRIGGER_FAILURES_TO_DISABLE = 5;
/** How many actions deep one trigger may cause another to fire. */
export const TRIGGER_DEPTH_MAX = 3;

const triggerShape = {
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  event: domainEventTypeSchema,
  filter: triggerFilterSchema,
  /** Required for `schedule.tick`, refused for anything else. */
  schedule: agentTaskScheduleSchema.nullable(),
  action: triggerActionSchema,
  /** Firings allowed per hourly window; past it an event is skipped, not queued. */
  maxPerHour: z.number().int().min(1).max(60),
};

const triggerFieldsSchema = z.object({
  ...triggerShape,
  enabled: triggerShape.enabled.default(true),
  filter: triggerShape.filter.default([]),
  schedule: triggerShape.schedule.default(null),
  maxPerHour: triggerShape.maxPerHour.default(10),
});

function checkTrigger(
  value: {
    event?: DomainEventType;
    filter?: TriggerFilter;
    schedule?: { cron: string; timeZone: string } | null;
    action?: TriggerAction;
  },
  context: z.RefinementCtx,
) {
  if (value.event === undefined) return;
  const fields: Record<string, EventFieldType> =
    DOMAIN_EVENT_FIELDS[value.event];
  for (const [index, condition] of (value.filter ?? []).entries()) {
    const type = fields[condition.field];
    if (!type) {
      context.addIssue({
        code: "custom",
        path: ["filter", index, "field"],
        message: `${value.event} has no field ${condition.field}`,
      });
      continue;
    }
    if (!TRIGGER_OPS_BY_TYPE[type].includes(condition.op)) {
      context.addIssue({
        code: "custom",
        path: ["filter", index, "op"],
        message: `${condition.op} does not apply to a ${type} field`,
      });
    }
    if (typeof condition.value !== type) {
      context.addIssue({
        code: "custom",
        path: ["filter", index, "value"],
        message: `${condition.field} is a ${type}`,
      });
    }
  }
  if (value.schedule !== undefined) {
    if (value.event === "schedule.tick" && !value.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "A schedule trigger needs a schedule",
      });
    }
    if (value.event !== "schedule.tick" && value.schedule) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message: "Only a schedule trigger takes a schedule",
      });
    }
  }
  if (value.action?.kind === "actions") {
    for (const [index, action] of value.action.actions.entries()) {
      if (
        action.kind === "insert-template" ||
        ("pageId" in action && action.pageId === THIS_PAGE) ||
        (action.kind === "create-page" && action.parentId === THIS_PAGE)
      ) {
        context.addIssue({
          code: "custom",
          path: ["action", "actions", index],
          message: "A trigger has no page of its own",
        });
      }
    }
  }
}

export const triggerInputSchema = triggerFieldsSchema.superRefine(checkTrigger);
export type TriggerInput = z.input<typeof triggerInputSchema>;

/**
 * A partial update, with no defaults: a field left out keeps its stored
 * value. The whole trigger is re-checked once merged.
 */
export const triggerPatchSchema = z
  .object(triggerShape)
  .partial()
  .superRefine(checkTrigger);
export type TriggerPatch = z.input<typeof triggerPatchSchema>;

export const triggerResultSchema = z.object({
  at: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
  /** The agent run an agent trigger started. */
  runId: z.string().optional(),
  conversationId: z.string().optional(),
});
export type TriggerResult = z.infer<typeof triggerResultSchema>;

export const workspaceTriggerSchema = triggerFieldsSchema.extend({
  id: z.string(),
  consecutiveFailures: z.number().int().min(0),
  /** Why it turned itself off; cleared when re-enabled. */
  disabledReason: z.string().nullable(),
  lastFiredAt: z.string().nullable(),
  lastResult: triggerResultSchema.nullable(),
  nextRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceTrigger = z.infer<typeof workspaceTriggerSchema>;

export const TRIGGER_FIRING_OUTCOMES = [
  "fired",
  "failed",
  "skipped-own",
  "skipped-depth",
  "skipped-rate",
] as const;
export const triggerFiringSchema = z.object({
  triggerId: z.string(),
  outcome: z.enum(TRIGGER_FIRING_OUTCOMES),
  error: z.string().optional(),
});
export type TriggerFiring = z.infer<typeof triggerFiringSchema>;

/** A stored event as the trigger list shows it. */
export const domainEventRecordSchema = z.object({
  id: z.string(),
  type: domainEventTypeSchema,
  payload: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  at: z.string(),
  depth: z.number().int().min(0),
  triggerIds: z.array(z.string()),
  firings: z.array(triggerFiringSchema),
});
export type DomainEventRecord = z.infer<typeof domainEventRecordSchema>;
