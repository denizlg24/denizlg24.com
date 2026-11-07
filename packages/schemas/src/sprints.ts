import { z } from "zod";
import { agentUIMessageSchema } from "./agent-chat";

const isoDateSchema = z.iso.datetime({ offset: true });
const objectIdSchema = z.string().regex(/^[a-f0-9]{24}$/, "Expected an id");

const timeZoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(
    (timeZone) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone }).format();
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid IANA time zone" },
  );

/** `owner/name`, as GitHub spells it. */
export const sprintRepoSchema = z
  .string()
  .trim()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/,
    "Expected owner/name",
  );

/**
 * git's own ref rules, narrowed: no `..`, no leading `-` or `/`, no trailing
 * `/` or `.lock`, nothing git or a shell would read as syntax.
 */
export const gitBranchSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/, "Letters, digits, . _ / - only")
  .refine(
    (value) =>
      !value.startsWith("-") &&
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.endsWith(".") &&
      !value.endsWith(".lock") &&
      !value.includes("..") &&
      !value.includes("//") &&
      !value.includes("/."),
    { message: "Not a valid branch name" },
  );

// ── Run configuration ──────────────────────────────────────────────────────

export const runHarnessSchema = z.enum(["claude-code"]);
export type RunHarness = z.infer<typeof runHarnessSchema>;

export const RUN_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const runEffortSchema = z.enum(RUN_EFFORTS);
export type RunEffort = z.infer<typeof runEffortSchema>;

/**
 * `default` is left out on purpose: in `-p` mode nothing can answer a
 * permission prompt, so a run in that mode only stalls until its timeout.
 */
export const runPermissionModeSchema = z.enum([
  "bypassPermissions",
  "acceptEdits",
  "plan",
]);
export type RunPermissionMode = z.infer<typeof runPermissionModeSchema>;

/**
 * `subscription` is a Claude Code seat's OAuth token (`claude setup-token`);
 * `gateway` is the Vercel AI Gateway's Anthropic-compatible endpoint.
 */
export const runCredentialSchema = z.enum(["subscription", "gateway"]);
export type RunCredential = z.infer<typeof runCredentialSchema>;

export const RUN_TIMEOUT_MIN_MINUTES = 5;
export const RUN_TIMEOUT_MAX_MINUTES = 360;

export const runConfigSchema = z.object({
  harness: runHarnessSchema,
  /** A Claude Code model id or alias, e.g. `claude-opus-5-5` or `sonnet`. */
  model: z.string().trim().min(1).max(200),
  effort: runEffortSchema,
  permissionMode: runPermissionModeSchema,
  credential: runCredentialSchema,
  /** Appended to the slot's task. */
  instructions: z.string().max(20_000),
  timeoutMinutes: z
    .number()
    .int()
    .min(RUN_TIMEOUT_MIN_MINUTES)
    .max(RUN_TIMEOUT_MAX_MINUTES),
});
export type RunConfig = z.infer<typeof runConfigSchema>;

export const runConfigOverrideSchema = runConfigSchema.partial();
export type RunConfigOverride = z.infer<typeof runConfigOverrideSchema>;

export const DEFAULT_RUN_CONFIG: RunConfig = {
  harness: "claude-code",
  model: "claude-opus-5-5",
  effort: "high",
  permissionMode: "bypassPermissions",
  credential: "subscription",
  instructions: "",
  timeoutMinutes: 90,
};

// ── Sprint ─────────────────────────────────────────────────────────────────

export const sprintStatusSchema = z.enum([
  "draft",
  "active",
  "completed",
  "cancelled",
]);
export type SprintStatus = z.infer<typeof sprintStatusSchema>;

/**
 * The release offer a sprint carries once its release slot passed CI. Merging
 * is the owner's; `sha` is what CI saw, so a later commit is never merged on
 * the strength of an earlier green run.
 */
export const sprintReleaseOfferSchema = z.object({
  runId: z.string(),
  sha: z.string().regex(/^[a-f0-9]{40}$/),
  readyAt: isoDateSchema,
  state: z.enum(["ready", "merging", "merged", "failed"]),
  mergedAt: isoDateSchema.optional(),
  mergeSha: z.string().optional(),
  error: z.string().max(2_000).optional(),
});
export type SprintReleaseOffer = z.infer<typeof sprintReleaseOfferSchema>;

export const sprintSchema = z.object({
  id: z.string(),
  title: z.string().trim().min(1).max(200),
  goal: z.string().max(20_000),
  repo: sprintRepoSchema,
  baseBranch: gitBranchSchema,
  branch: gitBranchSchema,
  defaults: runConfigSchema,
  prNumber: z.number().int().positive().optional(),
  prUrl: z.url().optional(),
  prState: z.enum(["draft", "open", "merged", "closed"]).optional(),
  release: sprintReleaseOfferSchema.optional(),
  status: sprintStatusSchema,
  timeZone: timeZoneSchema,
  /** True once any run has pushed; the branch name is fixed from then on. */
  branchLocked: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type Sprint = z.infer<typeof sprintSchema>;

export const createSprintSchema = z.object({
  title: z.string().trim().min(1).max(200),
  goal: z.string().max(20_000).default(""),
  repo: sprintRepoSchema,
  baseBranch: gitBranchSchema.default("main"),
  /** Generated as `sprint/<slug>-<4 hex>` when absent. */
  branch: gitBranchSchema.optional(),
  defaults: runConfigOverrideSchema.default({}),
  timeZone: timeZoneSchema.default("UTC"),
});
export type CreateSprint = z.infer<typeof createSprintSchema>;
export type CreateSprintInput = z.input<typeof createSprintSchema>;

/** Built from undefaulted fields, so an omitted field is left as stored. */
export const updateSprintSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    goal: z.string().max(20_000),
    repo: sprintRepoSchema,
    baseBranch: gitBranchSchema,
    branch: gitBranchSchema,
    defaults: runConfigOverrideSchema,
    timeZone: timeZoneSchema,
  })
  .partial();
export type UpdateSprint = z.infer<typeof updateSprintSchema>;

// ── Slots ──────────────────────────────────────────────────────────────────

export const SPRINT_SLOT_KINDS = [
  "implement",
  "review",
  "fix-review",
  "release",
  "custom",
] as const;
export const sprintSlotKindSchema = z.enum(SPRINT_SLOT_KINDS);
export type SprintSlotKind = z.infer<typeof sprintSlotKindSchema>;

export const sprintSlotStatusSchema = z.enum([
  "scheduled",
  "waiting",
  "queued",
  "running",
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
]);
export type SprintSlotStatus = z.infer<typeof sprintSlotStatusSchema>;

export const TERMINAL_SLOT_STATUSES: readonly SprintSlotStatus[] = [
  "succeeded",
  "failed",
  "skipped",
  "cancelled",
];

export function isTerminalSlotStatus(status: SprintSlotStatus): boolean {
  return TERMINAL_SLOT_STATUSES.includes(status);
}

export const slotSkipReasonSchema = z.enum([
  "upstream-failed",
  "upstream-skipped",
  "upstream-cancelled",
  "upstream-timeout",
  "release-unapproved",
  "release-no-pr",
  "dependency-cycle",
]);
export type SlotSkipReason = z.infer<typeof slotSkipReasonSchema>;

export const DEFAULT_UPSTREAM_WAIT_MINUTES = 240;

export const slotUpstreamPolicySchema = z.object({
  waitMinutes: z
    .number()
    .int()
    .min(0)
    .max(7 * 24 * 60),
});

export const sprintSlotSchema = z.object({
  id: z.string(),
  sprintId: z.string(),
  at: isoDateSchema,
  kind: sprintSlotKindSchema,
  title: z.string().trim().min(1).max(200),
  task: z.string().max(40_000),
  config: runConfigOverrideSchema,
  dependsOn: z.array(z.string()).max(32),
  onUpstreamRunning: slotUpstreamPolicySchema,
  status: sprintSlotStatusSchema,
  skipReason: slotSkipReasonSchema.optional(),
  lastRunId: z.string().optional(),
  order: z.number(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type SprintSlot = z.infer<typeof sprintSlotSchema>;

export const createSprintSlotSchema = z.object({
  at: isoDateSchema,
  kind: sprintSlotKindSchema,
  title: z.string().trim().min(1).max(200),
  task: z.string().max(40_000).default(""),
  config: runConfigOverrideSchema.default({}),
  /** Absent means "the slot before this one in time". */
  dependsOn: z.array(objectIdSchema).max(32).optional(),
  onUpstreamRunning: slotUpstreamPolicySchema.default({
    waitMinutes: DEFAULT_UPSTREAM_WAIT_MINUTES,
  }),
});
export type CreateSprintSlot = z.infer<typeof createSprintSlotSchema>;
export type CreateSprintSlotInput = z.input<typeof createSprintSlotSchema>;

export const updateSprintSlotSchema = z
  .object({
    at: isoDateSchema,
    kind: sprintSlotKindSchema,
    title: z.string().trim().min(1).max(200),
    task: z.string().max(40_000),
    config: runConfigOverrideSchema,
    dependsOn: z.array(objectIdSchema).max(32),
    onUpstreamRunning: slotUpstreamPolicySchema,
  })
  .partial();
export type UpdateSprintSlot = z.infer<typeof updateSprintSlotSchema>;

// ── Run results ────────────────────────────────────────────────────────────

export const findingSeveritySchema = z.enum([
  "blocker",
  "major",
  "minor",
  "nit",
]);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const findingSchema = z.object({
  id: z.string().trim().min(1).max(64),
  severity: findingSeveritySchema,
  file: z.string().max(1_000).optional(),
  line: z.number().int().positive().optional(),
  title: z.string().trim().min(1).max(300),
  detail: z.string().max(8_000),
});
export type Finding = z.infer<typeof findingSchema>;

const summarySchema = z.string().trim().min(1).max(8_000);

/**
 * What the agent writes to `$SPRINT_OUT/result.json`. The runner validates it;
 * a missing or invalid file fails the run as `no-result` even on exit 0.
 */
export const runResultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("implement"),
    summary: summarySchema,
    changedAreas: z.array(z.string().max(300)).max(100),
    testsRun: z.array(z.string().max(500)).max(100),
    notes: z.string().max(8_000).optional(),
  }),
  z.object({
    kind: z.literal("review"),
    summary: summarySchema,
    verdict: z.enum(["approve", "changes"]),
    findings: z.array(findingSchema).max(200),
  }),
  z.object({
    kind: z.literal("fix-review"),
    summary: summarySchema,
    addressed: z.array(z.string().max(64)).max(200),
    declined: z
      .array(
        z.object({ id: z.string().max(64), reason: z.string().max(2_000) }),
      )
      .max(200),
  }),
  z.object({
    kind: z.literal("release"),
    summary: summarySchema,
    version: z.string().max(100).optional(),
    steps: z.array(z.string().max(1_000)).max(100),
    ciRequired: z.boolean(),
  }),
  z.object({
    kind: z.literal("custom"),
    summary: summarySchema,
  }),
]);
export type RunResult = z.infer<typeof runResultSchema>;

// ── Coding runs ────────────────────────────────────────────────────────────

export const codingRunStatusSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type CodingRunStatus = z.infer<typeof codingRunStatusSchema>;

export function isLiveCodingRunStatus(status: CodingRunStatus): boolean {
  return status === "queued" || status === "running";
}

export const codingRunFailureCodeSchema = z.enum([
  "timeout",
  "runner-lost",
  "harness-error",
  "no-result",
  "push-rejected",
  "ci-failed",
  "admission-timeout",
  "workspace-error",
  "cancelled",
]);
export type CodingRunFailureCode = z.infer<typeof codingRunFailureCodeSchema>;

export const codingRunFailureSchema = z.object({
  code: codingRunFailureCodeSchema,
  message: z.string().max(8_000),
});
export type CodingRunFailure = z.infer<typeof codingRunFailureSchema>;

export const codingRunUsageSchema = z.object({
  inputTokens: z.number().nonnegative(),
  outputTokens: z.number().nonnegative(),
  cacheReadTokens: z.number().nonnegative(),
  cacheWriteTokens: z.number().nonnegative(),
  costUsd: z.number().nonnegative(),
  /** The subscription's `total_cost_usd` is an estimate, not a charge. */
  notional: z.boolean(),
});
export type CodingRunUsage = z.infer<typeof codingRunUsageSchema>;

export const codingRunCiSchema = z.object({
  state: z.enum(["pending", "success", "failure"]),
  checkedAt: isoDateSchema,
  url: z.url().optional(),
  failing: z
    .array(z.object({ name: z.string().max(300), url: z.url().optional() }))
    .max(50)
    .optional(),
});
export type CodingRunCi = z.infer<typeof codingRunCiSchema>;

const shaSchema = z.string().regex(/^[a-f0-9]{40}$/, "Expected a commit sha");

export const codingRunSummarySchema = z.object({
  id: z.string(),
  sprintId: z.string(),
  slotId: z.string(),
  kind: sprintSlotKindSchema,
  status: codingRunStatusSchema,
  failure: codingRunFailureSchema.optional(),
  repo: sprintRepoSchema,
  branch: gitBranchSchema,
  baseSha: shaSchema.optional(),
  headSha: shaSchema.optional(),
  usage: codingRunUsageSchema.optional(),
  ci: codingRunCiSchema.optional(),
  prUrl: z.url().optional(),
  startedAt: isoDateSchema.optional(),
  completedAt: isoDateSchema.optional(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});
export type CodingRunSummary = z.infer<typeof codingRunSummarySchema>;

export const codingRunSchema = codingRunSummarySchema.extend({
  config: runConfigSchema,
  result: runResultSchema.optional(),
  cancelRequested: z.boolean(),
  messages: z.array(agentUIMessageSchema),
  workspacePath: z.string().optional(),
  runnerVersion: z.string().optional(),
  harnessVersion: z.string().optional(),
});
export type CodingRun = z.infer<typeof codingRunSchema>;

/** `GET /sprints/:id` — the sprint with everything its page draws. */
export const sprintDetailSchema = z.object({
  sprint: sprintSchema,
  slots: z.array(sprintSlotSchema),
  runs: z.array(codingRunSummarySchema),
});
export type SprintDetail = z.infer<typeof sprintDetailSchema>;

export const sprintListItemSchema = sprintSchema.extend({
  slotCount: z.number().int().nonnegative(),
  nextSlotAt: isoDateSchema.optional(),
  lastRunStatus: codingRunStatusSchema.optional(),
});
export type SprintListItem = z.infer<typeof sprintListItemSchema>;

/** `GET /sprints/slots?from&to` — what the calendar overlays. */
export const sprintCalendarSlotSchema = z.object({
  id: z.string(),
  sprintId: z.string(),
  sprintTitle: z.string(),
  at: isoDateSchema,
  kind: sprintSlotKindSchema,
  title: z.string(),
  status: sprintSlotStatusSchema,
});
export type SprintCalendarSlot = z.infer<typeof sprintCalendarSlotSchema>;

// ── Runner protocol ────────────────────────────────────────────────────────

export const RUNNER_CLAIM_INTERVAL_MS = 15_000;
export const RUNNER_HEARTBEAT_INTERVAL_MS = 30_000;
export const RUNNER_LEASE_MS = 3 * 60_000;
/** A due slot the runner could never admit fails after this long. */
export const RUNNER_ADMISSION_TIMEOUT_MS = 2 * 60 * 60_000;
/** Transcript bound per run, as for agent-task runs. */
export const CODING_RUN_MAX_PARTS = 2_000;
export const CODING_RUN_MAX_TOOL_OUTPUT_CHARS = 16_000;

export const runnerClaimRequestSchema = z.object({
  runnerId: z.string().trim().min(1).max(200),
  capacity: z.number().int().min(0).max(8),
  /** False when memory, disk or a Forge build says not now. */
  admissible: z.boolean(),
});
export type RunnerClaimRequest = z.infer<typeof runnerClaimRequestSchema>;

/** Everything the runner needs to execute one run without asking again. */
export const claimedRunSchema = z.object({
  runId: z.string(),
  sprint: z.object({
    id: z.string(),
    title: z.string(),
    goal: z.string(),
    repo: sprintRepoSchema,
    baseBranch: gitBranchSchema,
    branch: gitBranchSchema,
    prNumber: z.number().int().positive().optional(),
    prUrl: z.url().optional(),
  }),
  slot: z.object({
    id: z.string(),
    kind: sprintSlotKindSchema,
    title: z.string(),
    task: z.string(),
  }),
  config: runConfigSchema,
  /** `SPRINT.md`, generated by web from the chain. */
  context: z.string(),
  /** The latest review in the chain, for a fix-review to answer. */
  findings: z.array(findingSchema).optional(),
});
export type ClaimedRun = z.infer<typeof claimedRunSchema>;

export const runnerMergeCommandSchema = z.object({
  type: z.literal("merge"),
  sprintId: z.string(),
  repo: sprintRepoSchema,
  prNumber: z.number().int().positive(),
  sha: shaSchema,
});
export type RunnerMergeCommand = z.infer<typeof runnerMergeCommandSchema>;

/** A sprint whose PR the runner should look at: merged on GitHub directly? */
export const runnerPrWatchSchema = z.object({
  sprintId: z.string(),
  repo: sprintRepoSchema,
  prNumber: z.number().int().positive(),
});
export type RunnerPrWatch = z.infer<typeof runnerPrWatchSchema>;

export const runnerClaimResponseSchema = z.object({
  runs: z.array(claimedRunSchema),
  commands: z.array(runnerMergeCommandSchema),
  prWatches: z.array(runnerPrWatchSchema),
});
export type RunnerClaimResponse = z.infer<typeof runnerClaimResponseSchema>;

export const runnerStartRequestSchema = z.object({
  baseSha: shaSchema,
  workspacePath: z.string().max(1_000),
  runnerVersion: z.string().max(100),
  harnessVersion: z.string().max(100).optional(),
});
export type RunnerStartRequest = z.infer<typeof runnerStartRequestSchema>;

export const runnerHeartbeatResponseSchema = z.object({
  cancelRequested: z.boolean(),
  /** False when web no longer holds the run as live: stop it. */
  live: z.boolean(),
});
export type RunnerHeartbeatResponse = z.infer<
  typeof runnerHeartbeatResponseSchema
>;

/**
 * A batch of transcript changes. Messages are upserted by id: a tool result
 * rewrites the step message that holds its call. Idempotent on `seq`.
 */
export const runnerEventsRequestSchema = z.object({
  seq: z.number().int().nonnegative(),
  messages: z.array(agentUIMessageSchema).max(200),
});
export type RunnerEventsRequest = z.infer<typeof runnerEventsRequestSchema>;

export const runnerCompleteRequestSchema = z
  .object({
    status: z.enum(["succeeded", "failed", "cancelled"]),
    result: runResultSchema.optional(),
    failure: codingRunFailureSchema.optional(),
    headSha: shaSchema.optional(),
    usage: codingRunUsageSchema.optional(),
    ci: codingRunCiSchema.optional(),
    prNumber: z.number().int().positive().optional(),
    prUrl: z.url().optional(),
    /** The branch reached GitHub at least once. */
    pushed: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (value.status === "succeeded" && !value.result) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "A succeeded run carries its result",
      });
    }
    if (value.status === "failed" && !value.failure) {
      context.addIssue({
        code: "custom",
        path: ["failure"],
        message: "A failed run carries its failure",
      });
    }
  });
export type RunnerCompleteRequest = z.infer<typeof runnerCompleteRequestSchema>;
export type RunnerCompleteRequestInput = z.input<
  typeof runnerCompleteRequestSchema
>;

export const runnerMergeResultSchema = z.object({
  ok: z.boolean(),
  mergeSha: z.string().optional(),
  error: z.string().max(2_000).optional(),
});
export type RunnerMergeResult = z.infer<typeof runnerMergeResultSchema>;

export const runnerPrStateSchema = z.object({
  state: z.enum(["draft", "open", "merged", "closed"]),
  mergeSha: z.string().optional(),
  mergedAt: isoDateSchema.optional(),
});
export type RunnerPrState = z.infer<typeof runnerPrStateSchema>;

/** `POST /api/deploy/github/run-token` on the cloud API. */
export const runTokenRequestSchema = z.object({
  repo: sprintRepoSchema,
  kind: sprintSlotKindSchema,
});
export type RunTokenRequest = z.infer<typeof runTokenRequestSchema>;

export const runTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: isoDateSchema,
  permissions: z.record(z.string(), z.string()),
});
export type RunTokenResponse = z.infer<typeof runTokenResponseSchema>;
