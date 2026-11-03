import { describe, expect, test } from "bun:test";
import { claimedRun } from "../test-fixtures";
import {
  buildPrompt,
  buildSystemPrompt,
  ClaudeCodeHarness,
  credentialEnv,
} from "./claude-code";
import { HarnessConfigError, type HarnessLaunch } from "./types";

const credentials = {
  subscriptionToken: "sk-ant-oat01-subscription",
  gatewayKey: "vck_gateway",
  gatewayBaseUrl: "https://ai-gateway.vercel.sh",
};

function launch(
  overrides: Parameters<typeof claimedRun>[0] = {},
): HarnessLaunch {
  return {
    run: claimedRun(overrides),
    paths: {
      out: "/out",
      context: "/out/context/SPRINT.md",
      findings: "/out/context/findings.json",
      result: "/out/result.json",
    },
    git: {
      mergeBase: "a".repeat(40),
      head: "b".repeat(40),
      baseTip: "c".repeat(40),
    },
    identity: { name: "Sprint Agent", email: "sprint@denizlg24.com" },
  };
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

describe("ClaudeCodeHarness.command", () => {
  test("headless stream-json with the run's model, effort and permission mode", () => {
    const base = launch();
    const command = new ClaudeCodeHarness(credentials).command({
      ...base,
      run: {
        ...base.run,
        config: {
          ...base.run.config,
          model: "sonnet",
          effort: "xhigh",
          permissionMode: "acceptEdits",
        },
      },
    });
    expect(command.entrypoint).toBe("claude");
    expect(command.args[0]).toBe("-p");
    expect(flag(command.args, "--output-format")).toBe("stream-json");
    expect(command.args).toContain("--verbose");
    expect(flag(command.args, "--model")).toBe("sonnet");
    expect(flag(command.args, "--effort")).toBe("xhigh");
    expect(flag(command.args, "--permission-mode")).toBe("acceptEdits");
    expect(command.env.HOME).toBe("/tmp/home");
    expect(command.env.SPRINT_OUT).toBe("/out");
    expect(command.env.SPRINT_MERGE_BASE).toBe("a".repeat(40));
    expect(command.env.GIT_AUTHOR_EMAIL).toBe("sprint@denizlg24.com");
  });

  test("the system prompt is the kind's preamble plus the run's instructions", () => {
    const base = launch({ slot: { ...claimedRun().slot, kind: "review" } });
    const plain = buildSystemPrompt(base.run);
    expect(plain).toContain('"kind": "review"');
    expect(plain).toContain(
      "Never push, never open or merge pull requests, never tag",
    );
    expect(plain).not.toContain("Instructions for this run");
    const withInstructions = buildSystemPrompt({
      ...base.run,
      config: { ...base.run.config, instructions: "Prefer small diffs." },
    });
    expect(withInstructions.endsWith("Prefer small diffs.")).toBe(true);
  });

  test("every kind's preamble ends on the runner's boundary", () => {
    for (const kind of [
      "implement",
      "review",
      "fix-review",
      "release",
      "custom",
    ] as const) {
      const run = claimedRun({ slot: { ...claimedRun().slot, kind } });
      expect(buildSystemPrompt(run)).toContain(`"kind": "${kind}"`);
      expect(
        buildSystemPrompt(run).trimEnd().endsWith("The runner does that."),
      ).toBe(true);
    }
  });

  test("the prompt names the context, and the findings only for fix-review", () => {
    expect(buildPrompt(launch())).toContain("/out/context/SPRINT.md");
    expect(buildPrompt(launch())).not.toContain("findings.json");
    const fix = launch({
      slot: { ...claimedRun().slot, kind: "fix-review", task: "" },
    });
    expect(buildPrompt(fix)).toContain("/out/context/findings.json");
    expect(buildPrompt(fix)).toContain("Address the latest review's findings.");
  });
});

describe("credential isolation", () => {
  test("a subscription run carries only the OAuth token", () => {
    const env = new ClaudeCodeHarness(credentials).command(launch()).env;
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe(credentials.subscriptionToken);
    expect(Object.keys(env)).not.toContain("ANTHROPIC_AUTH_TOKEN");
    expect(Object.keys(env)).not.toContain("ANTHROPIC_BASE_URL");
    expect(Object.values(env)).not.toContain(credentials.gatewayKey);
  });

  test("a gateway run carries only the gateway key", () => {
    const base = launch();
    const env = new ClaudeCodeHarness(credentials).command({
      ...base,
      run: {
        ...base.run,
        config: { ...base.run.config, credential: "gateway" },
      },
    }).env;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://ai-gateway.vercel.sh");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe(credentials.gatewayKey);
    expect(Object.keys(env)).not.toContain("CLAUDE_CODE_OAUTH_TOKEN");
    expect(Object.values(env)).not.toContain(credentials.subscriptionToken);
  });

  test("a missing credential refuses the run", () => {
    expect(() =>
      credentialEnv(claimedRun(), {
        gatewayKey: "x",
        gatewayBaseUrl: credentials.gatewayBaseUrl,
      }),
    ).toThrow(HarnessConfigError);
  });
});
