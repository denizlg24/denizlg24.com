import { z } from "zod";

/*
 * Shared foods are user-generated content: a food created with a barcode goes
 * into the catalogue everyone scans and searches. These are the contracts for
 * reporting one, hiding a contributor, and the owner's moderation console.
 */

export const macrosFoodReportReasons = [
  "offensive",
  "spam",
  "incorrect",
  "personal_info",
  "other",
] as const;
export const macrosFoodReportReasonSchema = z.enum(macrosFoodReportReasons);

export const macrosFoodReportReasonLabels: Record<
  MacrosFoodReportReason,
  string
> = {
  offensive: "Offensive or abusive",
  spam: "Spam or advertising",
  incorrect: "Wrong nutrition or name",
  personal_info: "Personal information",
  other: "Something else",
};

export const MACROS_REPORT_NOTE_MAX = 500;

export const macrosReportFoodBodySchema = z.object({
  reason: macrosFoodReportReasonSchema,
  note: z.string().trim().max(MACROS_REPORT_NOTE_MAX).optional(),
});

export const macrosReportFoodResponseSchema = z.object({
  report: z.object({
    id: z.uuid(),
    reason: macrosFoodReportReasonSchema,
    createdAt: z.string(),
  }),
  /** True when this report took the food out of search pending review. */
  hidden: z.boolean(),
});

/**
 * What the food sheet may offer for one food. `contributed` is whether a
 * person (rather than a published dataset) is known to have added it, which is
 * what makes hiding them possible; it never says who.
 */
export const macrosFoodSharingSchema = z.object({
  shared: z.boolean(),
  ownContribution: z.boolean(),
  contributed: z.boolean(),
  reported: z.boolean(),
  contributorHidden: z.boolean(),
});

export const macrosBlockContributorResponseSchema = z.object({
  block: z.object({
    id: z.uuid(),
    label: z.string(),
    createdAt: z.string(),
  }),
});

export const macrosBlockedContributorSchema = z.object({
  id: z.uuid(),
  /** The food the contributor was hidden from, which is all the user saw. */
  label: z.string(),
  createdAt: z.string(),
});

export const macrosBlockedContributorsResponseSchema = z.object({
  blocks: z.array(macrosBlockedContributorSchema),
});

/**
 * Why a barcoded food stayed private instead of joining the catalogue. Null
 * when it was shared, or when it matched a food already there.
 */
export const macrosSharingWithheldSchema = z
  .enum(["filtered", "suspended", "removed"])
  .nullable();

// Admin console --------------------------------------------------------------

export const macrosContributorRefSchema = z.object({
  id: z.string(),
  /** Stable pseudonym; the console never shows a name or email unasked. */
  alias: z.string(),
});

export const macrosModerationFoodSchema = z.object({
  itemId: z.uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  iconKey: z.string().nullable(),
  servingLabel: z.string().nullable(),
  caloriesPerServing: z.number().nullable(),
  proteinPerServing: z.number().nullable(),
  carbsPerServing: z.number().nullable(),
  fatPerServing: z.number().nullable(),
  /** The catalogue's provenance tag: `user` for a contribution. */
  source: z.string().nullable(),
  removed: z.boolean(),
  removedReason: z.string().nullable(),
  removedBy: z.string().nullable(),
  removedAt: z.string().nullable(),
});

export const macrosReportStatusFilterSchema = z.enum([
  "open",
  "resolved",
  "all",
]);

export const macrosReportCaseSchema = z.object({
  itemId: z.uuid(),
  food: macrosModerationFoodSchema,
  contributor: macrosContributorRefSchema.nullable(),
  open: z.boolean(),
  total: z.number().int(),
  openCount: z.number().int(),
  byReason: z.record(macrosFoodReportReasonSchema, z.number().int()),
  notes: z.array(
    z.object({
      reason: macrosFoodReportReasonSchema,
      note: z.string(),
      createdAt: z.string(),
    }),
  ),
  firstReportedAt: z.string(),
  lastReportedAt: z.string(),
});

export const macrosReportCasesResponseSchema = z.object({
  cases: z.array(macrosReportCaseSchema),
});

export const macrosResolveReportBodySchema = z.object({
  action: z.enum(["dismiss", "remove"]),
  reason: z.string().trim().max(500).optional(),
});

export const macrosContributionSchema = z.object({
  itemId: z.uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string(),
  contributor: macrosContributorRefSchema,
  createdAt: z.string(),
  removed: z.boolean(),
  removedReason: z.string().nullable(),
  removedBy: z.string().nullable(),
  reportCount: z.number().int(),
});

export const macrosContributionsQuerySchema = z.object({
  status: z.enum(["visible", "removed", "all"]).default("all"),
  q: z.string().trim().max(100).optional(),
  contributor: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const macrosContributionsResponseSchema = z.object({
  contributions: z.array(macrosContributionSchema),
  nextCursor: z.string().nullable(),
});

export const macrosSetFoodRemovedBodySchema = z.object({
  removed: z.boolean(),
  reason: z.string().trim().max(500).optional(),
});

export const macrosContributorRestrictionSchema = z.object({
  sharingSuspended: z.boolean(),
  suspended: z.boolean(),
  reason: z.string().nullable(),
  updatedAt: z.string().nullable(),
});

export const macrosContributorDetailSchema = z.object({
  contributor: macrosContributorRefSchema,
  joinedAt: z.string(),
  contributions: z.number().int(),
  removedContributions: z.number().int(),
  reportsAgainst: z.number().int(),
  reportsFiled: z.number().int(),
  blockedBy: z.number().int(),
  restriction: macrosContributorRestrictionSchema,
  recent: z.array(macrosContributionSchema),
});

export const macrosSetRestrictionBodySchema = z.object({
  sharingSuspended: z.boolean(),
  suspended: z.boolean(),
  reason: z.string().trim().max(500).optional(),
  /** Also take down everything they contributed. */
  removeContributions: z.boolean().default(false),
});

export const macrosRevealContactResponseSchema = z.object({
  email: z.string(),
});

export const macrosModerationEventSchema = z.object({
  id: z.uuid(),
  actor: z.string(),
  action: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
});

export const macrosModerationEventsResponseSchema = z.object({
  events: z.array(macrosModerationEventSchema),
});

export const macrosModerationOverviewSchema = z.object({
  openCases: z.number().int(),
  openReports: z.number().int(),
  autoHidden: z.number().int(),
  oldestOpenReportAt: z.string().nullable(),
  contributions7d: z.number().int(),
  contributionsTotal: z.number().int(),
  removedTotal: z.number().int(),
  restrictedContributors: z.number().int(),
  blocks: z.number().int(),
  reports30d: z.array(z.object({ day: z.string(), count: z.number().int() })),
  recentEvents: z.array(macrosModerationEventSchema),
});

export type MacrosFoodReportReason = z.infer<
  typeof macrosFoodReportReasonSchema
>;
export type MacrosReportFoodBody = z.input<typeof macrosReportFoodBodySchema>;
export type MacrosReportFoodResponse = z.infer<
  typeof macrosReportFoodResponseSchema
>;
export type MacrosFoodSharing = z.infer<typeof macrosFoodSharingSchema>;
export type MacrosBlockContributorResponse = z.infer<
  typeof macrosBlockContributorResponseSchema
>;
export type MacrosBlockedContributor = z.infer<
  typeof macrosBlockedContributorSchema
>;
export type MacrosBlockedContributorsResponse = z.infer<
  typeof macrosBlockedContributorsResponseSchema
>;
export type MacrosSharingWithheld = z.infer<typeof macrosSharingWithheldSchema>;
export type MacrosContributorRef = z.infer<typeof macrosContributorRefSchema>;
export type MacrosModerationFood = z.infer<typeof macrosModerationFoodSchema>;
export type MacrosReportStatusFilter = z.infer<
  typeof macrosReportStatusFilterSchema
>;
export type MacrosReportCase = z.infer<typeof macrosReportCaseSchema>;
export type MacrosReportCasesResponse = z.infer<
  typeof macrosReportCasesResponseSchema
>;
export type MacrosResolveReportBody = z.input<
  typeof macrosResolveReportBodySchema
>;
export type MacrosContribution = z.infer<typeof macrosContributionSchema>;
export type MacrosContributionsQuery = z.input<
  typeof macrosContributionsQuerySchema
>;
export type MacrosContributionsResponse = z.infer<
  typeof macrosContributionsResponseSchema
>;
export type MacrosSetFoodRemovedBody = z.input<
  typeof macrosSetFoodRemovedBodySchema
>;
export type MacrosContributorRestriction = z.infer<
  typeof macrosContributorRestrictionSchema
>;
export type MacrosContributorDetail = z.infer<
  typeof macrosContributorDetailSchema
>;
export type MacrosSetRestrictionBody = z.input<
  typeof macrosSetRestrictionBodySchema
>;
export type MacrosRevealContactResponse = z.infer<
  typeof macrosRevealContactResponseSchema
>;
export type MacrosModerationEvent = z.infer<typeof macrosModerationEventSchema>;
export type MacrosModerationEventsResponse = z.infer<
  typeof macrosModerationEventsResponseSchema
>;
export type MacrosModerationOverview = z.infer<
  typeof macrosModerationOverviewSchema
>;
