import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  type CreateSprintSlotInput,
  createSprintSchema,
  createSprintSlotSchema,
  RUNNER_ADMISSION_TIMEOUT_MS,
  RUNNER_LEASE_MS,
  type RunResult,
  runnerCompleteRequestSchema,
} from "@repo/schemas";
import type { MongoMemoryServer } from "mongodb-memory-server";
import { CodingRunModel } from "@/models/CodingRun";
import { SprintModel } from "@/models/Sprint";
import { SprintSlotModel } from "@/models/SprintSlot";
import {
  clearMongo,
  sprintMongoTestsEnabled,
  startMongo,
  stopMongo,
} from "./mongo.test-util";

/*
 * The runner protocol against a real mongod. Off by default like the
 * workspace suites; `bun run test:mongo` in apps/web runs it.
 */
mock.module("server-only", () => ({}));
interface RecordedPush {
  sprintTitle: string;
  slotTitle: string;
  subject: string;
}
const pushes: (RecordedPush & { kind: string })[] = [];
mock.module("./push", () => ({
  pushSprint: (kind: string, push: RecordedPush) => {
    pushes.push({ kind, ...push });
  },
}));

const SHA = "b".repeat(40);

async function modules() {
  const [service, runner] = await Promise.all([
    import("./service"),
    import("./runner"),
  ]);
  return { ...service, ...runner };
}

async function activeSprint(prNumber?: number) {
  const { createSprint, activateSprint } = await modules();
  const sprint = await createSprint(
    createSprintSchema.parse({
      title: "Sprint agent",
      repo: "denizlg24/sprint-e2e",
    }),
  );
  await activateSprint(sprint.id);
  if (prNumber) {
    await SprintModel.updateOne(
      { _id: sprint.id },
      { prNumber, prUrl: `https://github.com/x/y/pull/${prNumber}` },
    );
  }
  return sprint;
}

async function slot(
  sprintId: string,
  at: Date,
  overrides: Partial<CreateSprintSlotInput> = {},
) {
  const { createSlot } = await modules();
  return createSlot(
    sprintId,
    createSprintSlotSchema.parse({
      at: at.toISOString(),
      kind: "implement",
      title: `Slot ${at.toISOString()}`,
      task: "Do the thing",
      ...overrides,
    }),
  );
}

/** A finished upstream, as a completed claim would have left it. */
async function finished(sprintId: string, slotId: string, result: RunResult) {
  const run = await CodingRunModel.create({
    sprintId,
    slotId,
    kind: result.kind,
    config: {},
    repo: "denizlg24/sprint-e2e",
    branch: "sprint/x",
    status: "succeeded",
    result,
    completedAt: new Date(Date.now() - 60_000),
  });
  await SprintSlotModel.updateOne(
    { _id: slotId },
    { status: "succeeded", lastRunId: run._id },
  );
}

const past = (minutes: number) => new Date(Date.now() - minutes * 60_000);

describe.skipIf(!sprintMongoTestsEnabled)("runner protocol", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startMongo("sprints-runner-test");
  }, 600_000);

  afterAll(async () => {
    await stopMongo(server);
  });

  beforeEach(async () => {
    await clearMongo();
    pushes.length = 0;
  });

  test("two concurrent claims never return the same slot", async () => {
    const { claimRuns } = await modules();
    const sprint = await activeSprint();
    for (let index = 0; index < 5; index += 1) {
      await slot(sprint.id, past(10 - index), { dependsOn: [] });
    }
    const request = { runnerId: "r", capacity: 3, admissible: true };
    const [a, b] = await Promise.all([claimRuns(request), claimRuns(request)]);
    const ids = [...a.runs, ...b.runs].map((run) => run.slot.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(5);
    expect(await CodingRunModel.countDocuments()).toBe(5);
    const claimed = a.runs[0];
    expect(claimed?.config.model).toBe("claude-opus-5-5");
    expect(claimed?.context).toContain("# Sprint: Sprint agent");
    const run = await CodingRunModel.findById(claimed?.runId);
    expect(run?.status).toBe("queued");
    expect(run?.messages).toHaveLength(1);
  });

  test("capacity and admission bound a claim; a downstream waits", async () => {
    const { claimRuns } = await modules();
    const sprint = await activeSprint();
    const first = await slot(sprint.id, past(5));
    const second = await slot(sprint.id, past(4));
    expect(second.dependsOn).toEqual([first.id]);

    const refused = await claimRuns({
      runnerId: "r",
      capacity: 2,
      admissible: false,
    });
    expect(refused.runs).toEqual([]);
    const claim = await claimRuns({
      runnerId: "r",
      capacity: 2,
      admissible: true,
    });
    expect(claim.runs.map((run) => run.slot.id)).toEqual([first.id]);
    expect((await SprintSlotModel.findById(second.id))?.status).toBe("waiting");
  });

  test("a lapsed lease is runner-lost, fails the slot and pushes", async () => {
    const { claimRuns, sweepLapsedRuns } = await modules();
    const sprint = await activeSprint();
    const only = await slot(sprint.id, past(5));
    const claim = await claimRuns({
      runnerId: "r",
      capacity: 1,
      admissible: true,
    });
    const runId = claim.runs[0]?.runId;
    expect(runId).toBeDefined();

    expect(await sweepLapsedRuns(new Date())).toBe(0);
    const later = new Date(Date.now() + RUNNER_LEASE_MS + 1_000);
    expect(await sweepLapsedRuns(later)).toBe(1);
    const run = await CodingRunModel.findById(runId);
    expect(run?.status).toBe("failed");
    expect(run?.failure?.code).toBe("runner-lost");
    expect((await SprintSlotModel.findById(only.id))?.status).toBe("failed");
    expect(pushes).toEqual([
      {
        kind: "sprint_run_failed",
        sprintTitle: "Sprint agent",
        slotTitle: only.title,
        subject: only.id,
      },
    ]);
    expect((await SprintModel.findById(sprint.id))?.status).toBe("completed");
  });

  test("heartbeat extends a live lease and reports cancel", async () => {
    const { claimRuns, heartbeatRun, cancelRun, startRun } = await modules();
    const sprint = await activeSprint();
    await slot(sprint.id, past(5));
    const claim = await claimRuns({
      runnerId: "r",
      capacity: 1,
      admissible: true,
    });
    const runId = claim.runs[0]?.runId ?? "";
    await startRun(runId, {
      baseSha: SHA,
      workspacePath: "/runs/x",
      runnerVersion: "1",
    });
    expect(pushes.map((push) => push.kind)).toEqual(["sprint_run_started"]);
    await cancelRun(runId);
    const later = new Date(Date.now() + 60_000);
    expect(await heartbeatRun(runId, later)).toEqual({
      cancelRequested: true,
      live: true,
    });
    const run = await CodingRunModel.findById(runId);
    expect(run?.leaseExpiresAt?.getTime()).toBe(
      later.getTime() + RUNNER_LEASE_MS,
    );
  });

  test("a duplicate seq is ignored", async () => {
    const { appendRunEvents, claimRuns } = await modules();
    const sprint = await activeSprint();
    await slot(sprint.id, past(5));
    const claim = await claimRuns({
      runnerId: "r",
      capacity: 1,
      admissible: true,
    });
    const runId = claim.runs[0]?.runId ?? "";
    const step = (text: string) => ({
      id: "step-1",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text }],
    });
    expect(
      await appendRunEvents(runId, { seq: 0, messages: [step("one")] }),
    ).toEqual({ applied: true });
    expect(
      await appendRunEvents(runId, { seq: 0, messages: [step("retry")] }),
    ).toEqual({ applied: false });
    expect(
      await appendRunEvents(runId, { seq: 1, messages: [step("two")] }),
    ).toEqual({ applied: true });
    const run = await CodingRunModel.findById(runId);
    expect(run?.lastSeq).toBe(1);
    expect(run?.messages).toHaveLength(2);
    expect(run?.messages[1]).toMatchObject({
      id: "step-1",
      parts: [{ type: "text", text: "two" }],
    });
  });

  test("a release is never claimed on an unapproved chain", async () => {
    const { claimRuns } = await modules();
    const sprint = await activeSprint(7);
    const implement = await slot(sprint.id, past(30));
    const review = await slot(sprint.id, past(20), { kind: "review" });
    const release = await slot(sprint.id, past(10), { kind: "release" });
    await finished(sprint.id, implement.id, {
      kind: "implement",
      summary: "done",
      changedAreas: [],
      testsRun: [],
    });
    await finished(sprint.id, review.id, {
      kind: "review",
      summary: "needs work",
      verdict: "changes",
      findings: [{ id: "F1", severity: "major", title: "Broken", detail: "" }],
    });
    const claim = await claimRuns({
      runnerId: "r",
      capacity: 2,
      admissible: true,
    });
    expect(claim.runs).toEqual([]);
    const stored = await SprintSlotModel.findById(release.id);
    expect(stored?.status).toBe("skipped");
    expect(stored?.skipReason).toBe("release-unapproved");
    expect(pushes.map((push) => push.kind)).toEqual(["sprint_run_failed"]);
  });

  test("a fix-review gets the findings; an approved release is claimed", async () => {
    const { claimRuns } = await modules();
    const sprint = await activeSprint(7);
    const review = await slot(sprint.id, past(30), { kind: "review" });
    const fix = await slot(sprint.id, past(20), { kind: "fix-review" });
    await finished(sprint.id, review.id, {
      kind: "review",
      summary: "needs work",
      verdict: "changes",
      findings: [{ id: "F1", severity: "major", title: "Broken", detail: "" }],
    });
    const fixClaim = await claimRuns({
      runnerId: "r",
      capacity: 1,
      admissible: true,
    });
    expect(fixClaim.runs[0]?.slot.id).toBe(fix.id);
    expect(fixClaim.runs[0]?.findings?.map((f) => f.id)).toEqual(["F1"]);

    await CodingRunModel.deleteMany({ slotId: fix.id });
    await finished(sprint.id, fix.id, {
      kind: "fix-review",
      summary: "fixed",
      addressed: ["F1"],
      declined: [],
    });
    const release = await slot(sprint.id, past(10), { kind: "release" });
    const releaseClaim = await claimRuns({
      runnerId: "r",
      capacity: 1,
      admissible: true,
    });
    expect(releaseClaim.runs[0]?.slot.id).toBe(release.id);
  });

  test("a slot the runner never admits fails after the admission timeout", async () => {
    const { claimRuns } = await modules();
    const sprint = await activeSprint();
    const late = await slot(
      sprint.id,
      new Date(Date.now() - RUNNER_ADMISSION_TIMEOUT_MS - 60_000),
    );
    await claimRuns({ runnerId: "r", capacity: 1, admissible: false });
    const stored = await SprintSlotModel.findById(late.id);
    expect(stored?.status).toBe("failed");
    const run = await CodingRunModel.findById(stored?.lastRunId);
    expect(run?.failure?.code).toBe("admission-timeout");
    expect(pushes.map((push) => push.kind)).toEqual(["sprint_run_failed"]);
  });

  test("a green release offers itself, and merging completes the sprint", async () => {
    const { claimRuns, completeRun, recordMergeResult, requestMerge } =
      await modules();
    const sprint = await activeSprint();
    const review = await slot(sprint.id, past(30), { kind: "review" });
    await finished(sprint.id, review.id, {
      kind: "review",
      summary: "ok",
      verdict: "approve",
      findings: [],
    });
    await SprintModel.updateOne({ _id: sprint.id }, { prNumber: 3 });
    const release = await slot(sprint.id, past(10), { kind: "release" });
    const claim = await claimRuns({
      runnerId: "r",
      capacity: 1,
      admissible: true,
    });
    const runId = claim.runs[0]?.runId ?? "";
    expect(claim.runs[0]?.slot.id).toBe(release.id);

    const completed = await completeRun(
      runId,
      runnerCompleteRequestSchema.parse({
        status: "succeeded",
        result: {
          kind: "release",
          summary: "bumped",
          steps: [],
          ciRequired: false,
        },
        headSha: SHA,
        ci: { state: "success", checkedAt: new Date().toISOString() },
        pushed: true,
      }),
    );
    expect(completed.status).toBe("succeeded");
    let stored = await SprintModel.findById(sprint.id);
    expect(stored?.release?.state).toBe("ready");
    expect(stored?.release?.sha).toBe(SHA);
    expect(stored?.branchLocked).toBe(true);
    expect(stored?.status).toBe("active");
    expect(pushes.map((push) => push.kind)).toContain("sprint_release_ready");

    const again = await completeRun(
      runId,
      runnerCompleteRequestSchema.parse({
        status: "failed",
        failure: { code: "harness-error", message: "late" },
      }),
    );
    expect(again.status).toBe("succeeded");

    await requestMerge(sprint.id);
    const next = await claimRuns({
      runnerId: "r",
      capacity: 0,
      admissible: true,
    });
    expect(next.commands).toEqual([
      {
        type: "merge",
        sprintId: sprint.id,
        repo: "denizlg24/sprint-e2e",
        prNumber: 3,
        sha: SHA,
      },
    ]);
    const merged = await recordMergeResult(sprint.id, {
      ok: true,
      mergeSha: "c".repeat(40),
    });
    expect(merged.release?.state).toBe("merged");
    expect(merged.prState).toBe("merged");
    expect(merged.status).toBe("completed");
    stored = await SprintModel.findById(sprint.id);
    expect(stored?.status).toBe("completed");
  });

  test("the first PR a run reports is a draft on the sprint", async () => {
    const { claimRuns, completeRun } = await modules();
    const sprint = await activeSprint();
    await slot(sprint.id, past(5));
    const claim = await claimRuns({
      runnerId: "r",
      capacity: 1,
      admissible: true,
    });
    await completeRun(
      claim.runs[0]?.runId ?? "",
      runnerCompleteRequestSchema.parse({
        status: "succeeded",
        result: {
          kind: "implement",
          summary: "done",
          changedAreas: [],
          testsRun: [],
        },
        headSha: SHA,
        prNumber: 12,
        prUrl: "https://github.com/denizlg24/sprint-e2e/pull/12",
        pushed: true,
      }),
    );
    const stored = await SprintModel.findById(sprint.id);
    expect(stored?.prNumber).toBe(12);
    expect(stored?.prState).toBe("draft");
    expect(stored?.status).toBe("completed");
    expect(pushes.map((push) => push.kind)).toEqual(["sprint_run_finished"]);
  });
});
