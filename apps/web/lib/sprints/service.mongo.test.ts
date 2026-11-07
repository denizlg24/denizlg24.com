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
  type CreateSprintInput,
  type CreateSprintSlotInput,
  createSprintSchema,
  createSprintSlotSchema,
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
 * Sprint and slot CRUD against a real mongod. Off by default like the
 * workspace suites; `bun run test:mongo` in apps/web runs it.
 */
mock.module("server-only", () => ({}));

async function service() {
  return import("./service");
}

function sprintInput(overrides: Partial<CreateSprintInput> = {}) {
  return createSprintSchema.parse({
    title: "Sprint agent",
    repo: "denizlg24/denizlg24.com",
    ...overrides,
  });
}

function slotInput(at: string, overrides: Partial<CreateSprintSlotInput> = {}) {
  return createSprintSlotSchema.parse({
    at,
    kind: "implement",
    title: `Slot ${at}`,
    ...overrides,
  });
}

describe.skipIf(!sprintMongoTestsEnabled)("sprint service", () => {
  let server: MongoMemoryServer;

  beforeAll(async () => {
    server = await startMongo("sprints-service-test");
  }, 600_000);

  afterAll(async () => {
    await stopMongo(server);
  });

  beforeEach(async () => {
    await clearMongo();
  });

  test("create names the branch, resolves defaults, starts as draft", async () => {
    const { createSprint, getSprintDetail } = await service();
    const sprint = await createSprint(
      sprintInput({ defaults: { model: "sonnet" } }),
    );
    expect(sprint.branch).toMatch(/^sprint\/sprint-agent-[a-f0-9]{4}$/);
    expect(sprint.status).toBe("draft");
    expect(sprint.defaults.model).toBe("sonnet");
    expect(sprint.defaults.permissionMode).toBe("bypassPermissions");
    expect(sprint.branchLocked).toBe(false);
    const detail = await getSprintDetail(sprint.id);
    expect(detail.slots).toEqual([]);
    expect(detail.runs).toEqual([]);
  });

  test("update merges defaults and refuses a branch move once locked", async () => {
    const { createSprint, updateSprint, SprintError } = await service();
    const sprint = await createSprint(sprintInput());
    const updated = await updateSprint(sprint.id, {
      defaults: { effort: "max" },
      branch: "sprint/renamed",
    });
    expect(updated.defaults.effort).toBe("max");
    expect(updated.defaults.model).toBe(sprint.defaults.model);
    expect(updated.branch).toBe("sprint/renamed");

    await SprintModel.updateOne({ _id: sprint.id }, { branchLocked: true });
    const refused = await updateSprint(sprint.id, {
      branch: "sprint/other",
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(SprintError);
    expect(refused).toMatchObject({ status: 409, code: "BRANCH_LOCKED" });
    const same = await updateSprint(sprint.id, {
      branch: "sprint/renamed",
      title: "Renamed",
    });
    expect(same.title).toBe("Renamed");
  });

  test("a new slot depends on the one before it in time", async () => {
    const { createSprint, createSlot } = await service();
    const sprint = await createSprint(sprintInput());
    const first = await createSlot(
      sprint.id,
      slotInput("2026-11-04T09:00:00Z"),
    );
    const third = await createSlot(
      sprint.id,
      slotInput("2026-11-04T15:00:00Z"),
    );
    const second = await createSlot(
      sprint.id,
      slotInput("2026-11-04T12:00:00Z"),
    );
    expect(first.dependsOn).toEqual([]);
    expect(third.dependsOn).toEqual([first.id]);
    expect(second.dependsOn).toEqual([first.id]);
    expect(second.order).toBeGreaterThan(third.order);
  });

  test("dependencies must stay inside the sprint and acyclic", async () => {
    const { createSprint, createSlot, updateSlot, SprintError } =
      await service();
    const sprint = await createSprint(sprintInput());
    const other = await createSprint(sprintInput({ title: "Other" }));
    const foreign = await createSlot(
      other.id,
      slotInput("2026-11-04T09:00:00Z"),
    );
    const refusedForeign = await createSlot(
      sprint.id,
      slotInput("2026-11-04T09:00:00Z", { dependsOn: [foreign.id] }),
    ).catch((error: unknown) => error);
    expect(refusedForeign).toBeInstanceOf(SprintError);
    expect(refusedForeign).toMatchObject({ status: 400 });

    const a = await createSlot(sprint.id, slotInput("2026-11-04T09:00:00Z"));
    const b = await createSlot(sprint.id, slotInput("2026-11-04T10:00:00Z"));
    const c = await createSlot(sprint.id, slotInput("2026-11-04T11:00:00Z"));
    expect(c.dependsOn).toEqual([b.id]);
    const cycle = await updateSlot(sprint.id, a.id, {
      dependsOn: [c.id],
    }).catch((error: unknown) => error);
    expect(cycle).toMatchObject({ status: 400, code: "CYCLE" });
    const self = await updateSlot(sprint.id, a.id, {
      dependsOn: [a.id],
    }).catch((error: unknown) => error);
    expect(self).toMatchObject({ status: 400 });
  });

  test("deleting a slot removes it from every dependsOn", async () => {
    const { createSprint, createSlot, deleteSlot, getSprintDetail } =
      await service();
    const sprint = await createSprint(sprintInput());
    const a = await createSlot(sprint.id, slotInput("2026-11-04T09:00:00Z"));
    const b = await createSlot(sprint.id, slotInput("2026-11-04T10:00:00Z"));
    await createSlot(
      sprint.id,
      slotInput("2026-11-04T11:00:00Z", { dependsOn: [a.id, b.id] }),
    );
    await deleteSlot(sprint.id, a.id);
    const detail = await getSprintDetail(sprint.id);
    expect(detail.slots.map((slot) => slot.dependsOn)).toEqual([[], [b.id]]);
  });

  test("a live slot cannot be edited or deleted", async () => {
    const { createSprint, createSlot, updateSlot, deleteSlot } =
      await service();
    const sprint = await createSprint(sprintInput());
    const slot = await createSlot(sprint.id, slotInput("2026-11-04T09:00:00Z"));
    await SprintSlotModel.updateOne({ _id: slot.id }, { status: "running" });
    expect(
      await updateSlot(sprint.id, slot.id, { title: "x" }).catch(
        (error: unknown) => error,
      ),
    ).toMatchObject({ status: 409, code: "SLOT_LIVE" });
    expect(
      await deleteSlot(sprint.id, slot.id).catch((error: unknown) => error),
    ).toMatchObject({ status: 409, code: "SLOT_LIVE" });
  });

  test("activate, run now, retry and cancel move the right states", async () => {
    const {
      activateSprint,
      cancelSprint,
      createSlot,
      createSprint,
      retrySlot,
      runSlotNow,
    } = await service();
    const sprint = await createSprint(sprintInput());
    expect((await activateSprint(sprint.id)).status).toBe("active");
    expect(
      await activateSprint(sprint.id).catch((error: unknown) => error),
    ).toMatchObject({ status: 409 });

    const slot = await createSlot(sprint.id, slotInput("2030-01-01T09:00:00Z"));
    const now = await runSlotNow(sprint.id, slot.id);
    expect(new Date(now.at).getTime()).toBeLessThanOrEqual(Date.now());

    await SprintSlotModel.updateOne(
      { _id: slot.id },
      { status: "skipped", skipReason: "upstream-failed" },
    );
    const retried = await retrySlot(sprint.id, slot.id);
    expect(retried.status).toBe("scheduled");
    expect(retried.skipReason).toBeUndefined();

    const later = await createSlot(
      sprint.id,
      slotInput("2030-01-02T09:00:00Z"),
    );
    const run = await CodingRunModel.create({
      sprintId: sprint.id,
      slotId: later.id,
      kind: "implement",
      config: sprint.defaults,
      repo: sprint.repo,
      branch: sprint.branch,
      status: "running",
    });
    const cancelled = await cancelSprint(sprint.id);
    expect(cancelled.status).toBe("cancelled");
    const slots = await SprintSlotModel.find({ sprintId: sprint.id });
    expect(slots.every((row) => row.status === "cancelled")).toBe(true);
    const stored = await CodingRunModel.findById(run._id);
    expect(stored?.cancelRequested).toBe(true);
  });

  test("delete refuses a live run and removes slots and runs", async () => {
    const { createSprint, createSlot, deleteSprint } = await service();
    const sprint = await createSprint(sprintInput());
    const slot = await createSlot(sprint.id, slotInput("2026-11-04T09:00:00Z"));
    const run = await CodingRunModel.create({
      sprintId: sprint.id,
      slotId: slot.id,
      kind: "implement",
      config: sprint.defaults,
      repo: sprint.repo,
      branch: sprint.branch,
      status: "queued",
    });
    expect(
      await deleteSprint(sprint.id).catch((error: unknown) => error),
    ).toMatchObject({ status: 409, code: "RUN_LIVE" });
    await CodingRunModel.updateOne({ _id: run._id }, { status: "failed" });
    expect(await deleteSprint(sprint.id)).toEqual({ deleted: true });
    expect(await SprintSlotModel.countDocuments()).toBe(0);
    expect(await CodingRunModel.countDocuments()).toBe(0);
  });

  test("a queued run with a lapsed lease is cancelled outright", async () => {
    const { createSprint, createSlot, cancelRun } = await service();
    const sprint = await createSprint(sprintInput());
    const slot = await createSlot(sprint.id, slotInput("2026-11-04T09:00:00Z"));
    const run = await CodingRunModel.create({
      sprintId: sprint.id,
      slotId: slot.id,
      kind: "implement",
      config: sprint.defaults,
      repo: sprint.repo,
      branch: sprint.branch,
      status: "queued",
      leaseExpiresAt: new Date(Date.now() - 1_000),
    });
    await SprintSlotModel.updateOne(
      { _id: slot.id },
      { status: "queued", lastRunId: run._id },
    );
    const cancelled = await cancelRun(run._id.toString());
    expect(cancelled.status).toBe("cancelled");
    expect((await SprintSlotModel.findById(slot.id))?.status).toBe("cancelled");
  });

  test("merge needs a ready release", async () => {
    const { createSprint, requestMerge } = await service();
    const sprint = await createSprint(sprintInput());
    expect(
      await requestMerge(sprint.id).catch((error: unknown) => error),
    ).toMatchObject({ status: 409, code: "NOT_READY" });
    await SprintModel.updateOne(
      { _id: sprint.id },
      {
        prNumber: 7,
        release: {
          runId: "r",
          sha: "a".repeat(40),
          readyAt: new Date(),
          state: "ready",
        },
      },
    );
    expect((await requestMerge(sprint.id)).release?.state).toBe("merging");
  });

  test("calendar lists slots of non-cancelled sprints in the window", async () => {
    const { createSprint, createSlot, cancelSprint, listCalendarSlots } =
      await service();
    const live = await createSprint(sprintInput());
    const gone = await createSprint(sprintInput({ title: "Gone" }));
    await createSlot(live.id, slotInput("2026-11-04T09:00:00Z"));
    await createSlot(live.id, slotInput("2026-12-04T09:00:00Z"));
    await createSlot(gone.id, slotInput("2026-11-04T09:00:00Z"));
    await cancelSprint(gone.id);
    const slots = await listCalendarSlots(
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-12-01T00:00:00Z"),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]?.sprintTitle).toBe("Sprint agent");
  });
});
