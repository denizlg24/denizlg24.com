import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AgentDeploymentRequest,
  agentDeploymentRequestSchema,
  type ForgeHostSnapshot,
  forgeHostSnapshotSchema,
} from "@repo/schemas/cloud";
import type { z } from "zod";

import type { Exec, ExecOptions, ExecResult } from "./exec";

type DeploymentRequestInput = z.input<typeof agentDeploymentRequestSchema>;
type HostSnapshotInput = z.input<typeof forgeHostSnapshotSchema>;

/**
 * Test-only. Parsed rather than cast so the schema's defaults fill in every
 * optional section — which is the whole point: a test that only cares about CPU
 * should not have to restate the sensor, disk and process arrays every time one
 * more field is collected.
 */
export function hostSnapshot(
  overrides: Partial<HostSnapshotInput> = {},
): ForgeHostSnapshot {
  return forgeHostSnapshotSchema.parse({
    cpu: {
      usagePercent: 10,
      cores: 4,
      load1: 0.1,
      load5: 0.2,
      load15: 0.3,
      temperatureCelsius: 42,
    },
    memory: {
      totalBytes: 100,
      usedBytes: 50,
      availableBytes: 50,
      usagePercent: 50,
    },
    ...overrides,
  });
}

/**
 * Test-only. Parsed through the schema rather than cast, so a contract change
 * breaks the fixtures instead of letting the tests keep asserting on a shape
 * production no longer accepts.
 */
export function deploymentRequest(
  overrides: Partial<DeploymentRequestInput> = {},
): AgentDeploymentRequest {
  return agentDeploymentRequestSchema.parse({
    deploymentId: crypto.randomUUID(),
    targetId: crypto.randomUUID(),
    projectSlug: "hello-world",
    kind: "preview",
    hostname: "hello-world-abc123.denizlg24.com",
    repository: {
      owner: "denizlg24",
      name: "hello-world",
      ref: "refs/heads/main",
      sha: "0".repeat(40),
    },
    build: {},
    runtime: {},
    timeouts: {},
    ...overrides,
  });
}

export type ExecResponder = (
  options: ExecOptions,
) => Promise<Partial<ExecResult> | undefined> | Partial<ExecResult> | undefined;

export interface FakeExec {
  exec: Exec;
  calls: ExecOptions[];
  commands: string[];
  find: (needle: string) => ExecOptions | undefined;
}

/** Test-only. Every command succeeds silently unless the responder says otherwise. */
export function fakeExec(responder: ExecResponder = () => undefined): FakeExec {
  const calls: ExecOptions[] = [];
  const exec: Exec = async (options) => {
    calls.push(options);
    const response = (await responder(options)) ?? {};
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
      ...response,
    };
  };
  return {
    exec,
    calls,
    get commands() {
      return calls.map((call) => call.command.join(" "));
    },
    find: (needle) =>
      calls.find((call) => call.command.join(" ").includes(needle)),
  };
}

/** Test-only. Carries `fetch`'s extra properties so no cast is needed. */
export function fakeFetch(
  handler: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>,
): typeof fetch {
  return Object.assign(handler, { preconnect: () => {} });
}

export async function withTempDir<T>(
  body: (dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "forge-agent-"));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
