import { describe, expect, test } from "bun:test";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import { createClient, recordingUpstream } from "../harness.test-util";
import { registerStatus } from "./index";

const register: ToolRegistrar = (server, upstream) =>
  registerStatus(server, createApi(upstream));

describe("status tools", () => {
  test("reads go to the status page's admin API with the status token", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream, register);
    await client.call("status_overview");
    await client.call("status_incidents", { action: "list", state: "all" });
    await client.call("status_service_samples", {
      serviceId: "deep-health",
      minutes: 30,
    });
    expect(calls.map((call) => [call.side, call.method, call.path])).toEqual([
      ["status", "GET", "/api/admin/overview"],
      ["status", "GET", "/api/admin/incidents?state=all"],
      ["status", "GET", "/api/admin/services/deep-health/samples?minutes=30"],
    ]);
  });

  test("an update carries the verdict and an escalation posts the diagnosis", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream, register);
    await client.call("status_incidents", {
      action: "update",
      id: "auto:1",
      text: "Deploy in progress; recovered on its own.",
      visibility: "private",
      state: "identified",
      verdict: "transient",
    });
    await client.call("status_incidents", {
      action: "escalate",
      id: "auto:1",
      body: "## Diagnosis\nThe collector crashes on …",
    });
    expect(calls.map((call) => [call.method, call.path])).toEqual([
      ["POST", "/api/admin/incidents/auto%3A1/updates"],
      ["POST", "/api/admin/incidents/auto%3A1/escalate"],
    ]);
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      text: "Deploy in progress; recovered on its own.",
      visibility: "private",
      state: "identified",
      verdict: "transient",
    });
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      body: "## Diagnosis\nThe collector crashes on …",
      labels: [],
    });
  });

  test("read actions are flagged read-only and writes are not", async () => {
    const { upstream } = recordingUpstream();
    const tools = await createClient(upstream, register).listTools();
    const incidents = tools.find((tool) => tool.name === "status_incidents");
    const flags = incidents?._meta?.["com.denizlg24/actions"] as Record<
      string,
      { readOnly: boolean }
    >;
    expect(flags.list?.readOnly).toBe(true);
    expect(flags.get?.readOnly).toBe(true);
    expect(flags.update?.readOnly).toBe(false);
    expect(flags.escalate?.readOnly).toBe(false);
    expect(incidents?.annotations?.readOnlyHint).toBe(false);
  });

  test("a weekly maintenance window is refused when it spans a week", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream, register);
    const result = await client.call("status_maintenance", {
      action: "create",
      title: "Reboot",
      description: "Weekly host reboot",
      serviceIds: ["api"],
      startsAt: "2026-09-13T01:55:00.000Z",
      endsAt: "2026-09-21T02:20:00.000Z",
      repeat: "weekly",
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
