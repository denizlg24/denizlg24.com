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
  confidence: z.number(),
  summary: z.string().optional(),
  matchedCourseId: z.string().optional(),
  matchedCourseName: z.string().optional(),
  attachmentTextUsed: z.boolean(),
  attachmentTextSources: z.array(z.string()),
  suggestedTasks: z.array(triageTaskSuggestionSchema),
  suggestedEvents: z.array(triageEventSuggestionSchema),
  userStatus: z.enum(["pending", "reviewed", "archived"]),
  modelUsed: z.string(),
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
  categoryRouting: z.record(triageCategorySchema, triageCategoryRoutingSchema),
  lastRunAt: z.string().optional(),
});
export type ITriageSettings = z.infer<typeof triageSettingsSchema>;

export const triageFilterSchema = z.union([
  triageCategorySchema,
  z.literal("archived"),
]);

export type TriageFilter = z.infer<typeof triageFilterSchema>;

export const triageListResponseSchema = z.object({
  items: z.array(emailTriageSchema),
  totalRows: z.number(),
  offset: z.number(),
  limit: z.number(),
});
export type TriageListResponse = z.infer<typeof triageListResponseSchema>;
