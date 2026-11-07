import {
  DEFAULT_RUN_CONFIG,
  type Finding,
  type RunConfig,
  type RunConfigOverride,
  type RunResult,
  runConfigSchema,
  type SlotSkipReason,
  type SprintSlotKind,
  type SprintSlotStatus,
} from "@repo/schemas";

export interface EvaluableSlot {
  id: string;
  at: Date;
  kind: SprintSlotKind;
  status: SprintSlotStatus;
  dependsOn: readonly string[];
  waitMinutes: number;
  order: number;
  result?: RunResult | null;
}

export type SlotDecision =
  | { type: "not-due" }
  | { type: "eligible" }
  | { type: "wait" }
  | { type: "skip"; reason: SlotSkipReason };

const PENDING: readonly SprintSlotStatus[] = [
  "scheduled",
  "waiting",
  "queued",
  "running",
];

function byTime(a: EvaluableSlot, b: EvaluableSlot): number {
  return a.at.getTime() - b.at.getTime() || a.order - b.order;
}

/**
 * Every slot reachable through `dependsOn`, excluding the start. A reference
 * to a slot that no longer exists is ignored, the same as no edge.
 */
export function transitiveUpstream(
  slotId: string,
  slots: ReadonlyMap<string, EvaluableSlot>,
): { upstream: EvaluableSlot[]; cyclic: boolean } {
  const seen = new Set<string>();
  const stack = [...(slots.get(slotId)?.dependsOn ?? [])];
  let cyclic = false;
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (id === slotId) {
      cyclic = true;
      continue;
    }
    if (seen.has(id)) continue;
    const slot = slots.get(id);
    if (!slot) continue;
    seen.add(id);
    stack.push(...slot.dependsOn);
  }
  const upstream = [...seen]
    .map((id) => slots.get(id))
    .filter((slot): slot is EvaluableSlot => slot !== undefined);
  return { upstream, cyclic };
}

/** The first cycle found as a path of ids, or null. Used to refuse a write. */
export function findDependencyCycle(
  slots: readonly { id: string; dependsOn: readonly string[] }[],
): string[] | null {
  const edges = new Map(slots.map((slot) => [slot.id, slot.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const path: string[] = [];

  const visit = (id: string): string[] | null => {
    const mark = state.get(id);
    if (mark === "done") return null;
    if (mark === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    path.push(id);
    for (const next of edges.get(id) ?? []) {
      if (!edges.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    state.set(id, "done");
    return null;
  };

  for (const slot of slots) {
    const cycle = visit(slot.id);
    if (cycle) return cycle;
  }
  return null;
}

function terminalSkipReason(status: SprintSlotStatus): SlotSkipReason | null {
  if (status === "failed") return "upstream-failed";
  if (status === "skipped") return "upstream-skipped";
  if (status === "cancelled") return "upstream-cancelled";
  return null;
}

/**
 * A release ships only an approved chain: the latest review among its
 * upstreams approved, or a fix-review that succeeded after it answered it.
 * A chain with no review at all is not approved.
 */
function releaseApproved(upstream: readonly EvaluableSlot[]): boolean {
  const ordered = [...upstream].sort(byTime);
  const reviews = ordered.filter((slot) => slot.kind === "review");
  const latest = reviews.at(-1);
  if (!latest) return false;
  if (latest.result?.kind === "review" && latest.result.verdict === "approve") {
    return true;
  }
  const latestIndex = ordered.indexOf(latest);
  return ordered
    .slice(latestIndex + 1)
    .some((slot) => slot.kind === "fix-review" && slot.status === "succeeded");
}

/**
 * What the scheduler does with one slot now. Pure: the claim pass reads the
 * sprint's slots, decides each due one with this, and writes the outcome.
 */
export function evaluateSlot(
  slot: EvaluableSlot,
  slots: ReadonlyMap<string, EvaluableSlot>,
  context: { now: Date; hasPr: boolean },
): SlotDecision {
  if (slot.status !== "scheduled" && slot.status !== "waiting") {
    return { type: "not-due" };
  }
  if (slot.at.getTime() > context.now.getTime()) return { type: "not-due" };

  const { upstream: transitive, cyclic } = transitiveUpstream(slot.id, slots);
  if (cyclic) return { type: "skip", reason: "dependency-cycle" };

  const upstream =
    slot.kind === "release"
      ? transitive
      : slot.dependsOn
          .map((id) => slots.get(id))
          .filter((up): up is EvaluableSlot => up !== undefined);

  for (const up of upstream) {
    const reason = terminalSkipReason(up.status);
    if (reason) return { type: "skip", reason };
  }

  if (upstream.some((up) => PENDING.includes(up.status))) {
    const deadline = slot.at.getTime() + slot.waitMinutes * 60_000;
    return context.now.getTime() >= deadline
      ? { type: "skip", reason: "upstream-timeout" }
      : { type: "wait" };
  }

  if (slot.kind === "release") {
    if (!releaseApproved(transitive)) {
      return { type: "skip", reason: "release-unapproved" };
    }
    if (!context.hasPr) return { type: "skip", reason: "release-no-pr" };
  }

  return { type: "eligible" };
}

/** Plan defaults with the slot's override on top; undefined fields inherit. */
export function resolveRunConfig(
  defaults: RunConfigOverride,
  override: RunConfigOverride,
): RunConfig {
  const merged: Record<string, unknown> = { ...DEFAULT_RUN_CONFIG };
  for (const source of [defaults, override]) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return runConfigSchema.parse(merged);
}

/** The slot immediately before `at`, which a new slot depends on by default. */
export function defaultDependsOn(
  slots: readonly { id: string; at: Date; order: number }[],
  at: Date,
): string[] {
  let previous: { id: string; at: Date; order: number } | null = null;
  for (const slot of slots) {
    if (slot.at.getTime() >= at.getTime()) continue;
    if (
      !previous ||
      slot.at.getTime() > previous.at.getTime() ||
      (slot.at.getTime() === previous.at.getTime() &&
        slot.order > previous.order)
    ) {
      previous = slot;
    }
  }
  return previous ? [previous.id] : [];
}

export function slugifySprintTitle(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return slug || "sprint";
}

/** `sprint/<slug>-<4 hex>`; `suffix` is passed in so this stays pure. */
export function sprintBranchName(title: string, suffix: string): string {
  return `sprint/${slugifySprintTitle(title)}-${suffix}`;
}

export interface SprintContextInput {
  sprint: {
    title: string;
    goal: string;
    repo: string;
    branch: string;
    baseBranch: string;
    prUrl?: string;
  };
  slots: readonly (EvaluableSlot & { title: string })[];
  currentSlotId: string;
}

function findingLine(finding: Finding): string {
  const where = finding.file
    ? ` (${finding.file}${finding.line ? `:${finding.line}` : ""})`
    : "";
  const detail = finding.detail.trim()
    ? `\n  ${finding.detail.trim().replace(/\n/g, "\n  ")}`
    : "";
  return `- **${finding.id}** [${finding.severity}] ${finding.title}${where}${detail}`;
}

function resultSection(result: RunResult): string[] {
  const lines = [result.summary.trim()];
  switch (result.kind) {
    case "implement":
      if (result.changedAreas.length > 0) {
        lines.push("", `Changed: ${result.changedAreas.join(", ")}`);
      }
      if (result.testsRun.length > 0) {
        lines.push(`Tests run: ${result.testsRun.join("; ")}`);
      }
      if (result.notes) lines.push("", result.notes.trim());
      break;
    case "review":
      lines.push("", `Verdict: ${result.verdict}`);
      if (result.findings.length > 0) {
        lines.push("", ...result.findings.map(findingLine));
      }
      break;
    case "fix-review":
      if (result.addressed.length > 0) {
        lines.push("", `Addressed: ${result.addressed.join(", ")}`);
      }
      for (const declined of result.declined) {
        lines.push(`- Declined **${declined.id}**: ${declined.reason}`);
      }
      break;
    case "release":
      if (result.version) lines.push("", `Version: ${result.version}`);
      lines.push(...result.steps.map((step) => `- ${step}`));
      break;
    case "custom":
      break;
  }
  return lines;
}

function formatWhen(at: Date): string {
  return at.toISOString().replace(":00.000Z", "Z").replace("T", " ");
}

/**
 * `SPRINT.md`: the chain as the next run needs to read it. The goal, every
 * slot with its status, and in full what each finished upstream reported.
 */
export function buildSprintContext(input: SprintContextInput): string {
  const { sprint, currentSlotId } = input;
  const slots = [...input.slots].sort(byTime);
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const current = byId.get(currentSlotId);
  const { upstream } = transitiveUpstream(currentSlotId, byId);
  const upstreamIds = new Set(upstream.map((slot) => slot.id));

  const lines = [
    `# Sprint: ${sprint.title}`,
    "",
    `- Repository: ${sprint.repo}`,
    `- Branch: ${sprint.branch} (from ${sprint.baseBranch})`,
  ];
  if (sprint.prUrl) lines.push(`- Pull request: ${sprint.prUrl}`);
  lines.push("", "## Goal", "", sprint.goal.trim() || "—", "", "## Slots", "");
  lines.push("| # | When (UTC) | Kind | Title | Status |");
  lines.push("|---|---|---|---|---|");
  slots.forEach((slot, index) => {
    const marker = slot.id === currentSlotId ? " ← this run" : "";
    lines.push(
      `| ${index + 1} | ${formatWhen(slot.at)} | ${slot.kind} | ${slot.title.replace(/\|/g, "\\|")} | ${slot.status}${marker} |`,
    );
  });

  const finished = slots.filter(
    (slot) => upstreamIds.has(slot.id) && slot.result,
  );
  if (finished.length > 0) {
    lines.push("", "## What earlier runs reported");
    for (const slot of finished) {
      if (!slot.result) continue;
      lines.push(
        "",
        `### ${slot.title} (${slot.kind}, ${slot.status})`,
        "",
        ...resultSection(slot.result),
      );
    }
  }

  if (current) {
    lines.push(
      "",
      "## This run",
      "",
      `You are the ${current.kind} slot "${current.title}". Each slot builds on the branch the previous one left.`,
    );
  }
  lines.push(
    "",
    "## Conventions",
    "",
    "Read the repository's own CLAUDE.md, AGENTS.md and CONTRIBUTING.md (whichever exist, at the root and in the directories you touch) before changing anything, and follow them.",
    "",
  );
  return lines.join("\n");
}

/** The latest review's findings among the slot's upstreams, for a fix-review. */
export function latestUpstreamFindings(
  slotId: string,
  slots: ReadonlyMap<string, EvaluableSlot>,
): Finding[] | undefined {
  const { upstream } = transitiveUpstream(slotId, slots);
  const reviews = upstream
    .filter((slot) => slot.result?.kind === "review")
    .sort(byTime);
  const latest = reviews.at(-1)?.result;
  return latest?.kind === "review" ? latest.findings : undefined;
}
