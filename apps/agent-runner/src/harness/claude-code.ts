import {
  type ClaimedRun,
  CODING_RUN_MAX_TOOL_OUTPUT_CHARS,
  type SprintSlotKind,
} from "@repo/schemas";
import { ClaudeStreamMapper } from "@repo/utils/claude-stream";
import type { RunnerConfig } from "../config";
import customPrompt from "../prompts/custom.md" with { type: "text" };
import fixReviewPrompt from "../prompts/fix-review.md" with { type: "text" };
import implementPrompt from "../prompts/implement.md" with { type: "text" };
import releasePrompt from "../prompts/release.md" with { type: "text" };
import reviewPrompt from "../prompts/review.md" with { type: "text" };
import {
  type HarnessAdapter,
  type HarnessCommand,
  HarnessConfigError,
  type HarnessLaunch,
  type HarnessStream,
} from "./types";

/** Must equal the runtime image's `CLAUDE_CODE_VERSION`. */
export const CLAUDE_CODE_VERSION = "2.1.317";

export const KIND_PREAMBLES: Record<SprintSlotKind, string> = {
  implement: implementPrompt,
  review: reviewPrompt,
  "fix-review": fixReviewPrompt,
  release: releasePrompt,
  custom: customPrompt,
};

const DEFAULT_TASKS: Record<SprintSlotKind, string> = {
  implement: "Implement the sprint goal.",
  review: "Review the sprint branch.",
  "fix-review": "Address the latest review's findings.",
  release: "Prepare the release.",
  custom: "",
};

export function buildPrompt(launch: HarnessLaunch): string {
  const { run, paths } = launch;
  const task = run.slot.task.trim() || DEFAULT_TASKS[run.slot.kind];
  const lines = [
    `# ${run.slot.title}`,
    "",
    task,
    "",
    `Sprint context: ${paths.context}`,
  ];
  if (run.slot.kind === "fix-review") {
    lines.push(`Review findings: ${paths.findings}`);
  }
  lines.push(`Write your result to ${paths.result} before you finish.`);
  return lines.join("\n");
}

export function buildSystemPrompt(run: ClaimedRun): string {
  const preamble = KIND_PREAMBLES[run.slot.kind].trim();
  const instructions = run.config.instructions.trim();
  return instructions
    ? `${preamble}\n\n## Instructions for this run\n\n${instructions}`
    : preamble;
}

/**
 * Only the credential the slot chose enters the container. The other one is
 * absent, not empty: Claude Code reads an empty `CLAUDE_CODE_OAUTH_TOKEN` as
 * set on some paths.
 */
export function credentialEnv(
  run: ClaimedRun,
  credentials: RunnerConfig["credentials"],
): Record<string, string> {
  if (run.config.credential === "subscription") {
    if (!credentials.subscriptionToken) {
      throw new HarnessConfigError(
        "This slot uses the subscription credential and CLAUDE_CODE_OAUTH_TOKEN is not set",
      );
    }
    return { CLAUDE_CODE_OAUTH_TOKEN: credentials.subscriptionToken };
  }
  if (!credentials.gatewayKey) {
    throw new HarnessConfigError(
      "This slot uses the gateway credential and AI_GATEWAY_API_KEY is not set",
    );
  }
  return {
    ANTHROPIC_BASE_URL: credentials.gatewayBaseUrl,
    ANTHROPIC_AUTH_TOKEN: credentials.gatewayKey,
  };
}

export class ClaudeCodeHarness implements HarnessAdapter {
  readonly harness = "claude-code" as const;
  readonly version = CLAUDE_CODE_VERSION;

  constructor(private readonly credentials: RunnerConfig["credentials"]) {}

  command(launch: HarnessLaunch): HarnessCommand {
    const { run, paths, git, identity } = launch;
    return {
      entrypoint: "claude",
      args: [
        "-p",
        buildPrompt(launch),
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        run.config.model,
        "--effort",
        run.config.effort,
        "--permission-mode",
        run.config.permissionMode,
        "--append-system-prompt",
        buildSystemPrompt(run),
      ],
      env: {
        HOME: "/tmp/home",
        SPRINT_OUT: paths.out,
        SPRINT_MERGE_BASE: git.mergeBase,
        SPRINT_BASE_SHA: git.head,
        SPRINT_BASE_BRANCH: run.sprint.baseBranch,
        SPRINT_BRANCH: run.sprint.branch,
        GIT_AUTHOR_NAME: identity.name,
        GIT_AUTHOR_EMAIL: identity.email,
        GIT_COMMITTER_NAME: identity.name,
        GIT_COMMITTER_EMAIL: identity.email,
        DISABLE_AUTOUPDATER: "1",
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        ...credentialEnv(run, this.credentials),
      },
    };
  }

  stream(): HarnessStream {
    const mapper = new ClaudeStreamMapper({
      maxToolOutputChars: CODING_RUN_MAX_TOOL_OUTPUT_CHARS,
    });
    return {
      push: (chunk) => mapper.push(chunk),
      end: () => mapper.end(),
      takeDirty: () => mapper.takeDirty(),
      notice: (level, text) => mapper.notice(level, text),
      outcome: () => {
        const result = mapper.result();
        if (!result) return null;
        return {
          isError: result.isError,
          subtype: result.subtype,
          text: result.text,
          usage: result.usage,
          totalCostUsd: result.totalCostUsd,
        };
      },
    };
  }
}
