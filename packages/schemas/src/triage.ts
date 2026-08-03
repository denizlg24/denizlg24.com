import { z } from "zod";

export const triageCategorySchema = z.enum([
  "spam",
  "newsletter",
  "promo",
  "purchases",
  "fyi",
  "action-needed",
  "scheduled",
]);
export type TriageCategory = z.infer<typeof triageCategorySchema>;
/** The same seven labels as an array, for mongoose enums and runtime guards. */
export const TRIAGE_CATEGORIES = triageCategorySchema.options;

export const triageSuggestionStatusSchema = z.enum([
  "pending",
  "accepted",
  "dismissed",
]);
export type TriageSuggestionStatus = z.infer<
  typeof triageSuggestionStatusSchema
>;

export const triagePrioritySchema = z.enum([
  "none",
  "low",
  "medium",
  "high",
  "urgent",
]);
export type TriagePriority = z.infer<typeof triagePrioritySchema>;

export const triageCourseAssignmentTypeSchema = z.enum([
  "assignment",
  "exam",
  "quiz",
  "project",
  "lab",
  "reading",
  "other",
]);
export type TriageCourseAssignmentType = z.infer<
  typeof triageCourseAssignmentTypeSchema
>;

export const triageTaskSuggestionSchema = z.object({
  _id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  priority: triagePrioritySchema,
  dueDate: z.string().optional(),
  dueHasTime: z.boolean().optional(),
  kanbanBoardId: z.string().optional(),
  kanbanBoardTitle: z.string().optional(),
  kanbanColumnId: z.string().optional(),
  kanbanColumnTitle: z.string().optional(),
  courseId: z.string().optional(),
  courseName: z.string().optional(),
  updatesCourseDeadlineId: z.string().optional(),
  assignmentType: triageCourseAssignmentTypeSchema.optional(),
  status: triageSuggestionStatusSchema,
  acceptedCardId: z.string().optional(),
  acceptedAssignmentId: z.string().optional(),
});
export type ITriageTaskSuggestion = z.infer<typeof triageTaskSuggestionSchema>;

export const triageEventSuggestionSchema = z.object({
  _id: z.string(),
  title: z.string(),
  date: z.string(),
  place: z.string().optional(),
  courseId: z.string().optional(),
  courseName: z.string().optional(),
  updatesCalendarEventId: z.string().optional(),
  status: triageSuggestionStatusSchema,
  acceptedEventId: z.string().optional(),
});
export type ITriageEventSuggestion = z.infer<
  typeof triageEventSuggestionSchema
>;

export const emailTriageSchema = z.object({
  _id: z.string(),
  emailId: z.string(),
  accountId: z.string(),
  stage: z.enum(["prefilter", "full"]),
  category: triageCategorySchema,
  modelCategory: triageCategorySchema.optional(),
  /** Pre-correction label; present only once a human has overridden `category`. */
  llmCategory: triageCategorySchema.optional(),
  confidence: z.number(),
  classificationThreshold: z.number().min(0).max(1).optional(),
  classificationProbabilities: z
    .record(triageCategorySchema, z.number().min(0).max(1))
    .optional(),
  reviewRequired: z.boolean(),
  reviewReason: z.string().optional(),
  summary: z.string().optional(),
  matchedCourseId: z.string().optional(),
  matchedCourseName: z.string().optional(),
  attachmentTextUsed: z.boolean(),
  attachmentTextSources: z.array(z.string()),
  suggestedTasks: z.array(triageTaskSuggestionSchema),
  suggestedEvents: z.array(triageEventSuggestionSchema),
  userStatus: z.enum(["pending", "reviewed", "archived"]),
  modelUsed: z.string(),
  extractionModelUsed: z.string().optional(),
  triagedAt: z.string(),
  email: z
    .object({
      subject: z.string(),
      from: z.array(
        z.object({
          name: z.string().optional(),
          address: z.string(),
        }),
      ),
      date: z.string(),
      threadId: z.string().optional(),
    })
    .nullable(),
});
export type IEmailTriage = z.infer<typeof emailTriageSchema>;

/**
 * `GET /triage/{id}`. The detail route returns the email as a sibling of the
 * triage row rather than nested inside it, and adds the fetched message body.
 */
export const triageDetailResponseSchema = z.object({
  triage: emailTriageSchema.omit({ email: true }),
  email: z.object({
    _id: z.string(),
    accountId: z.string(),
    subject: z.string(),
    from: z.array(
      z.object({ name: z.string().optional(), address: z.string() }),
    ),
    date: z.string(),
    threadId: z.string().optional(),
    body: z.object({ text: z.string(), html: z.string() }).nullable(),
  }),
});
export type TriageDetailResponse = z.infer<typeof triageDetailResponseSchema>;

export const triageCategoryRoutingSchema = z.object({
  autoCreateCard: z.boolean(),
  autoAcceptThreshold: z.number(),
});
export type ITriageCategoryRouting = z.infer<
  typeof triageCategoryRoutingSchema
>;

export const triageSettingsSchema = z.object({
  _id: z.string(),
  enabled: z.boolean(),
  runIntervalMinutes: z.number(),
  prefilterModel: z.string(),
  fullModel: z.string(),
  classificationConfidenceThreshold: z.number().min(0).max(1),
  categoryRouting: z.record(triageCategorySchema, triageCategoryRoutingSchema),
  lastRunAt: z.string().optional(),
});
export type ITriageSettings = z.infer<typeof triageSettingsSchema>;

/** `GET`/`PATCH /triage/settings`. */
export const triageSettingsResponseSchema = z.object({
  settings: triageSettingsSchema,
});
export type TriageSettingsResponse = z.infer<
  typeof triageSettingsResponseSchema
>;

export const triageFilterSchema = z.union([
  triageCategorySchema,
  z.literal("review"),
  z.literal("archived"),
]);

export type TriageFilter = z.infer<typeof triageFilterSchema>;

export const triageListResponseSchema = z.object({
  items: z.array(emailTriageSchema),
  totalRows: z.number(),
  /**
   * Count per filter tab, keyed by category plus "review" and "archived".
   * Only sent for the first page — the badges do not change while paging.
   */
  stats: z.partialRecord(triageFilterSchema, z.number()).optional(),
  offset: z.number(),
  limit: z.number(),
});
export type TriageListResponse = z.infer<typeof triageListResponseSchema>;

/**
 * `PATCH /triage/{id}/suggestions/{suggestionId}`. `placedIn` is set only when
 * the suggestion carried no kanban target and one was picked for it, so the
 * owner can see where an unrouted task actually landed.
 */
export const triageAcceptanceResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    acceptedId: z.string(),
    placedIn: z.string().optional(),
  }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type TriageAcceptanceResponse = z.infer<
  typeof triageAcceptanceResponseSchema
>;
