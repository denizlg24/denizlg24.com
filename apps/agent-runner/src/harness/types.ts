import type { AgentUIMessage, ClaimedRun, RunHarness } from "@repo/schemas";

/** Where things are, as the container sees them. */
export interface HarnessPaths {
  out: string;
  context: string;
  findings: string;
  result: string;
}

export interface HarnessLaunch {
  run: ClaimedRun;
  paths: HarnessPaths;
  git: { mergeBase: string; head: string; baseTip: string };
  identity: { name: string; email: string };
}

export interface HarnessCommand {
  entrypoint: string;
  args: string[];
  /** Goes into the container through an env file; may hold the model credential. */
  env: Record<string, string>;
}

export interface HarnessOutcome {
  isError: boolean;
  subtype: string;
  text: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
  totalCostUsd: number;
}

/** Turns a harness's stdout into transcript messages, incrementally. */
export interface HarnessStream {
  push(chunk: string): void;
  end(): void;
  takeDirty(): AgentUIMessage[];
  notice(level: "info" | "warning", text: string): void;
  outcome(): HarnessOutcome | null;
}

/**
 * One coding agent CLI. Claude Code is the only one; anything else (Codex)
 * would be another implementation of this, not branches in the runner.
 */
export interface HarnessAdapter {
  readonly harness: RunHarness;
  /** The CLI version baked into the runtime image. */
  readonly version: string;
  command(launch: HarnessLaunch): HarnessCommand;
  stream(): HarnessStream;
}

export class HarnessConfigError extends Error {}
