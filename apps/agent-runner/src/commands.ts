import type {
  RunnerMergeCommand,
  RunnerPrState,
  RunnerPrWatch,
} from "@repo/schemas";
import { type GitHubClient, pullState, type RunTokenSource } from "./github";
import type { RunnerWebApi } from "./web-client";

export interface CommandDeps {
  web: Pick<RunnerWebApi, "mergeResult" | "prState">;
  runTokens: Pick<RunTokenSource, "get">;
  github: (token: () => string) => Pick<GitHubClient, "merge" | "getPull">;
}

/**
 * The owner's "Merge": no container, just the merge API pinned to the sha CI
 * saw, so a commit pushed after the green run cannot ride along.
 */
export async function handleMerge(
  command: RunnerMergeCommand,
  deps: CommandDeps,
): Promise<void> {
  let outcome: { ok: true; sha: string } | { ok: false; error: string };
  try {
    const token = await deps.runTokens.get(command.repo, "release");
    outcome = await deps
      .github(() => token.token)
      .merge(command.repo, command.prNumber, command.sha);
  } catch (error) {
    outcome = { ok: false, error: String(error).slice(0, 2_000) };
  }
  await deps.web.mergeResult(
    command.sprintId,
    outcome.ok
      ? { ok: true, mergeSha: outcome.sha }
      : { ok: false, error: outcome.error.slice(0, 2_000) },
  );
}

/** Reports a sprint PR's state when it changed, e.g. merged on GitHub directly. */
export class PrWatcher {
  readonly #last = new Map<string, string>();

  constructor(private readonly deps: CommandDeps) {}

  async watch(watch: RunnerPrWatch): Promise<void> {
    const token = await this.deps.runTokens.get(watch.repo, "review");
    const pull = await this.deps
      .github(() => token.token)
      .getPull(watch.repo, watch.prNumber);
    const state: RunnerPrState = pullState(pull);
    const key = JSON.stringify(state);
    if (this.#last.get(watch.sprintId) === key) return;
    await this.deps.web.prState(watch.sprintId, state);
    this.#last.set(watch.sprintId, key);
  }
}
