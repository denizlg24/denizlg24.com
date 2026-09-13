import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { ToolRegistrar } from "../server";
import { action, createApi, defineActions } from "./define";
import { createClient, recordingUpstream } from "./harness.test-util";

const register: ToolRegistrar = (server, upstream) => {
  const api = createApi(upstream);
  defineActions(server, {
    name: "web_probe",
    title: "probe",
    description: "probe",
    actions: {
      create: action({
        description: "create",
        input: z.object({
          kind: z.string().default("expense"),
          year: z
            .number()
            .nullable()
            .transform((value) => value ?? undefined),
          decision: z.object({ verdict: z.enum(["yes"]) }),
        }),
        run: (body) => api.web.post("/probe", body),
      }),
      update: action({
        description: "update",
        input: z.object({
          id: z.string(),
          kind: z.string().optional(),
          year: z.number().nullable().optional(),
          decision: z.object({ ids: z.array(z.string()) }),
        }),
        idempotent: true,
        run: ({ id, ...body }) => api.web.patch(`/probe/${id}`, body),
      }),
    },
  });
};

describe("defineActions", () => {
  test("one action's defaults and transforms never reach another action", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream, register);
    await client.call("web_probe", {
      action: "update",
      id: "1",
      year: null,
      decision: { ids: ["a"] },
    });
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      year: null,
      decision: { ids: ["a"] },
    });

    await client.call("web_probe", {
      action: "create",
      year: null,
      decision: { verdict: "yes" },
    });
    expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
      kind: "expense",
      decision: { verdict: "yes" },
    });
  });

  test("advertises the merged schema with defaults and per-action labels", async () => {
    const { upstream } = recordingUpstream();
    const [tool] = await createClient(upstream, register).listTools();
    const properties = tool?.inputSchema.properties as Record<
      string,
      { description?: string; default?: unknown; anyOf?: unknown[] }
    >;
    expect(tool?.inputSchema.required).toEqual(["action"]);
    expect(properties.kind?.description).toBe("[create, update]");
    expect(properties.decision?.anyOf).toHaveLength(2);
    expect(properties.id?.description).toBe("[update]");
  });

  test("refuses a non-object argument set before any action runs", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream, register);
    const result = await client.call("web_probe", { action: "create" });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe("defineTool", () => {
  test("refuses invalid input as a tool error without calling upstream", async () => {
    const { upstream, calls } = recordingUpstream();
    const client = createClient(upstream);
    const result = await client.call("forge_target_get", {
      targetId: "not-a-uuid",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("INVALID_INPUT");
    expect(calls).toHaveLength(0);
  });

  test("accepts a call with no arguments for an empty input", async () => {
    const { upstream, calls } = recordingUpstream();
    const result = await createClient(upstream).call("forge_targets_list");
    expect(result.isError).toBeUndefined();
    expect(calls[0]?.path).toBe("/api/deploy/targets");
  });
});
