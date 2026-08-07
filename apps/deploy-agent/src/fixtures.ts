import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type AgentDeploymentRequest,
  agentDeploymentRequestSchema,
} from "@repo/schemas/cloud";
import type { z } from "zod";

import type { Exec, ExecOptions, ExecResult } from "./exec";

type DeploymentRequestInput = z.input<typeof agentDeploymentRequestSchema>;

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
