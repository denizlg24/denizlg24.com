import { beforeEach, describe, expect, test } from "bun:test";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import {
  createClient,
  type RecordedCall,
  recordingUpstream,
} from "../harness.test-util";
import { registerWebSprints } from "./sprints";

const register: ToolRegistrar = (server, upstream) => {
  registerWebSprints(server, createApi(upstream));
};

const { upstream, calls } = recordingUpstream();
const client = createClient(upstream, register);

const SPRINT = "6a2150ee03ea4b5aa67b1027";
const SLOT = "6a2150ee03ea4b5aa67b1028";
const RUN = "6a2150ee03ea4b5aa67b1029";

function last(): RecordedCall {
  const call = calls.at(-1);
  if (!call) throw new Error("no upstream call recorded");
  return call;
}

function lastJson(): Record<string, unknown> {
  return JSON.parse(last().body ?? "null") as Record<string, unknown>;
}

async function expectCall(
  args: Record<string, unknown>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const before = calls.length;
  const result = await client.call("web_sprints", args);
  expect(result.isError).toBeFalsy();
  expect(calls.length).toBe(before + 1);
  expect(last().method).toBe(method);
  expect(last().path).toBe(path);
  if (body !== undefined) expect(lastJson()).toEqual(body);
}

beforeEach(() => {
  calls.length = 0;
});

describe("web_sprints", () => {
  test("reads", async () => {
    await expectCall({ action: "list" }, "GET", "/api/admin/sprints");
    await expectCall(
      { action: "get", sprintId: SPRINT },
      "GET",
      `/api/admin/sprints/${SPRINT}`,
    );
    await expectCall(
      { action: "run_get", runId: RUN },
      "GET",
      `/api/admin/sprints/runs/${RUN}`,
    );
    await expectCall(
      {
        action: "slots",
        from: "2026-11-01T00:00:00Z",
        to: "2026-12-01T00:00:00Z",
      },
      "GET",
      "/api/admin/sprints/slots?from=2026-11-01T00%3A00%3A00Z&to=2026-12-01T00%3A00%3A00Z",
    );
  });

  test("create applies the contract's defaults", async () => {
    await expectCall(
      { action: "create", title: "Importer", repo: "denizlg24/x" },
      "POST",
      "/api/admin/sprints",
      {
        title: "Importer",
        repo: "denizlg24/x",
        goal: "",
        baseBranch: "main",
        defaults: {},
        timeZone: "UTC",
      },
    );
  });

  test("update sends only what it names", async () => {
    await expectCall(
      { action: "update", sprintId: SPRINT, title: "Renamed" },
      "PATCH",
      `/api/admin/sprints/${SPRINT}`,
      { title: "Renamed" },
    );
    await expectCall(
      { action: "slot_update", sprintId: SPRINT, slotId: SLOT, task: "More" },
      "PATCH",
      `/api/admin/sprints/${SPRINT}/slots/${SLOT}`,
      { task: "More" },
    );
  });

  test("slot_create leaves dependsOn to the server when omitted", async () => {
    await expectCall(
      {
        action: "slot_create",
        sprintId: SPRINT,
        at: "2026-11-04T09:00:00Z",
        kind: "review",
        title: "Review",
      },
      "POST",
      `/api/admin/sprints/${SPRINT}/slots`,
      {
        at: "2026-11-04T09:00:00Z",
        kind: "review",
        title: "Review",
        task: "",
        config: {},
        onUpstreamRunning: { waitMinutes: 240 },
      },
    );
  });

  test("transitions", async () => {
    await expectCall(
      { action: "activate", sprintId: SPRINT },
      "POST",
      `/api/admin/sprints/${SPRINT}/activate`,
    );
    await expectCall(
      { action: "cancel", sprintId: SPRINT },
      "POST",
      `/api/admin/sprints/${SPRINT}/cancel`,
    );
    await expectCall(
      { action: "run_now", sprintId: SPRINT, slotId: SLOT },
      "POST",
      `/api/admin/sprints/${SPRINT}/slots/${SLOT}/run-now`,
    );
    await expectCall(
      { action: "retry", sprintId: SPRINT, slotId: SLOT },
      "POST",
      `/api/admin/sprints/${SPRINT}/slots/${SLOT}/retry`,
    );
    await expectCall(
      { action: "slot_delete", sprintId: SPRINT, slotId: SLOT },
      "DELETE",
      `/api/admin/sprints/${SPRINT}/slots/${SLOT}`,
    );
    await expectCall(
      { action: "cancel_run", runId: RUN },
      "POST",
      `/api/admin/sprints/runs/${RUN}/cancel`,
    );
  });

  test("there is no merge action", async () => {
    const result = await client.call("web_sprints", {
      action: "merge",
      sprintId: SPRINT,
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("an interactive permission mode is refused before it reaches web", async () => {
    const result = await client.call("web_sprints", {
      action: "update",
      sprintId: SPRINT,
      defaults: { permissionMode: "default" },
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
