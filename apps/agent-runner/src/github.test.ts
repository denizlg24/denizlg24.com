import { describe, expect, test } from "bun:test";
import {
  appendRunRow,
  type CheckRuns,
  type CombinedStatus,
  commentableLines,
  evaluateChecks,
  type GitHubClient,
  initialPullBody,
  planReview,
  postReview,
  RunTokenSource,
  waitForCi,
} from "./github";
import { HttpError } from "./http";
import { ServiceTokens } from "./oauth";

const SHA = "d".repeat(40);

// Trimmed from real api.github.com responses.
const RUNS_IN_PROGRESS: CheckRuns = {
  check_runs: [
    {
      id: 101,
      name: "typecheck",
      status: "in_progress",
      conclusion: null,
      html_url: "https://github.com/denizlg24/sprint-e2e/runs/101",
    },
    {
      id: 102,
      name: "test",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/denizlg24/sprint-e2e/runs/102",
    },
  ],
};
const RUNS_GREEN: CheckRuns = {
  check_runs: [
    { ...RUNS_IN_PROGRESS.check_runs[1]!, id: 102 },
    {
      id: 103,
      name: "typecheck",
      status: "completed",
      conclusion: "success",
      html_url: "https://github.com/denizlg24/sprint-e2e/runs/103",
    },
    {
      id: 104,
      name: "lint",
      status: "completed",
      conclusion: "skipped",
      html_url: null,
    },
  ],
};
const RUNS_RED: CheckRuns = {
  check_runs: [
    { ...RUNS_GREEN.check_runs[0]! },
    {
      id: 105,
      name: "typecheck",
      status: "completed",
      conclusion: "failure",
      html_url: "https://github.com/denizlg24/sprint-e2e/runs/105",
    },
  ],
};
const NO_STATUSES: CombinedStatus = { statuses: [] };
const NO_RUNS: CheckRuns = { check_runs: [] };

describe("evaluateChecks", () => {
  test("pending while any check runs", () => {
    expect(evaluateChecks(RUNS_IN_PROGRESS, NO_STATUSES, null).state).toBe(
      "pending",
    );
  });

  test("success when everything passed or was skipped", () => {
    expect(evaluateChecks(RUNS_GREEN, NO_STATUSES, null).state).toBe("success");
  });

  test("failure names the failing check and its url", () => {
    const evaluation = evaluateChecks(RUNS_RED, NO_STATUSES, null);
    expect(evaluation.state).toBe("failure");
    expect(evaluation.failing).toEqual([
      {
        name: "typecheck",
        url: "https://github.com/denizlg24/sprint-e2e/runs/105",
      },
    ]);
  });

  test("the latest run of a re-run check wins", () => {
    const rerun: CheckRuns = {
      check_runs: [
        { ...RUNS_RED.check_runs[1]!, id: 200 },
        { ...RUNS_GREEN.check_runs[1]!, id: 201 },
      ],
    };
    expect(evaluateChecks(rerun, NO_STATUSES, null).state).toBe("success");
  });

  test("a required check that never reported is pending", () => {
    expect(
      evaluateChecks(RUNS_GREEN, NO_STATUSES, ["typecheck", "deploy"]).state,
    ).toBe("pending");
  });

  test("required checks ignore everything else", () => {
    expect(evaluateChecks(RUNS_RED, NO_STATUSES, ["test"]).state).toBe(
      "success",
    );
  });

  test("commit statuses count as checks", () => {
    expect(
      evaluateChecks(
        NO_RUNS,
        {
          statuses: [
            {
              context: "vercel",
              state: "error",
              target_url: "https://vercel.com/x",
            },
          ],
        },
        null,
      ).state,
    ).toBe("failure");
  });

  test("none when nothing is configured", () => {
    expect(evaluateChecks(NO_RUNS, NO_STATUSES, null).state).toBe("none");
  });
});

function recordedClient(
  sequence: CheckRuns[],
  required: string[] | null = null,
) {
  let call = 0;
  return {
    checkRuns: async () => sequence[Math.min(call++, sequence.length - 1)]!,
    combinedStatus: async () => NO_STATUSES,
    requiredChecks: async () => required,
  };
}

describe("waitForCi", () => {
  const timing = {
    intervalMs: 60_000,
    timeoutMs: 60 * 60_000,
    graceMs: 30_000,
  };

  function clock() {
    let now = 0;
    return {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
  }

  test("polls until green", async () => {
    const outcome = await waitForCi({
      client: recordedClient([RUNS_IN_PROGRESS, RUNS_IN_PROGRESS, RUNS_GREEN]),
      repo: "denizlg24/sprint-e2e",
      sha: SHA,
      baseBranch: "main",
      ciRequired: true,
      ...timing,
      ...clock(),
    });
    expect(outcome.kind).toBe("success");
  });

  test("red is a failure with the failing checks", async () => {
    const outcome = await waitForCi({
      client: recordedClient([RUNS_IN_PROGRESS, RUNS_RED]),
      repo: "denizlg24/sprint-e2e",
      sha: SHA,
      baseBranch: "main",
      ciRequired: true,
      ...timing,
      ...clock(),
    });
    expect(outcome.kind).toBe("failure");
    if (outcome.kind === "failure") {
      expect(outcome.ci.failing?.[0]?.name).toBe("typecheck");
      expect(outcome.message).toContain("runs/105");
    }
  });

  test("no checks and ciRequired false succeeds at the first look", async () => {
    const time = clock();
    const outcome = await waitForCi({
      client: recordedClient([NO_RUNS]),
      repo: "denizlg24/sprint-e2e",
      sha: SHA,
      baseBranch: "main",
      ciRequired: false,
      ...timing,
      ...time,
    });
    expect(outcome.kind).toBe("success");
    expect(time.now()).toBe(30_000);
  });

  test("no checks and ciRequired true times out after 60 minutes", async () => {
    const time = clock();
    const outcome = await waitForCi({
      client: recordedClient([NO_RUNS]),
      repo: "denizlg24/sprint-e2e",
      sha: SHA,
      baseBranch: "main",
      ciRequired: true,
      ...timing,
      ...time,
    });
    expect(outcome.kind).toBe("timeout");
    expect(time.now()).toBeLessThanOrEqual(60 * 60_000 + 30_000);
  });

  test("a cancel ends the wait", async () => {
    const outcome = await waitForCi({
      client: recordedClient([RUNS_IN_PROGRESS]),
      repo: "denizlg24/sprint-e2e",
      sha: SHA,
      baseBranch: "main",
      ciRequired: true,
      cancelled: () => true,
      ...timing,
      ...clock(),
    });
    expect(outcome.kind).toBe("cancelled");
  });
});

describe("pull request body", () => {
  const row = {
    slot: "Add hello | world",
    kind: "implement" as const,
    status: "succeeded",
    summary: "Added\nhello.txt",
  };

  test("the first body holds the goal and a one-row table", () => {
    const body = initialPullBody("Ship it.", row);
    expect(body.startsWith("Ship it.")).toBe(true);
    expect(body).toContain(
      "| Add hello \\| world | implement | succeeded | Added hello.txt |",
    );
  });

  test("later runs append rows inside the table", () => {
    const first = initialPullBody("Ship it.", row);
    const second = appendRunRow(first, {
      ...row,
      slot: "Review",
      kind: "review",
      status: "approve",
    });
    const lines = second.split("\n");
    const end = lines.indexOf("<!-- /sprint-runs -->");
    expect(lines[end - 1]).toContain("| Review | review | approve |");
    expect(lines[end - 2]).toContain("| Add hello");
  });

  test("a body that lost its table gets a new one", () => {
    expect(appendRunRow("Edited by hand.", row)).toContain(
      "Edited by hand.\n\n<!-- sprint-runs -->",
    );
  });
});

describe("review", () => {
  const patch =
    "@@ -1,3 +1,4 @@\n line one\n-old\n+new\n+added\n line four\n@@ -20,2 +21,2 @@\n context\n+late";

  test("commentable lines are the new side of each hunk", () => {
    expect([...commentableLines(patch)].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 21, 22,
    ]);
  });

  test("findings that resolve become inline comments; the rest go in the body", () => {
    const plan = planReview(
      {
        summary: "Two problems.",
        verdict: "changes",
        findings: [
          {
            id: "R1",
            severity: "blocker",
            file: "a.ts",
            line: 3,
            title: "Wrong",
            detail: "Fix.",
          },
          {
            id: "R2",
            severity: "minor",
            file: "a.ts",
            line: 10,
            title: "Off-diff",
            detail: "Hm.",
          },
          { id: "R3", severity: "nit", title: "General", detail: "Style." },
        ],
      },
      [{ filename: "a.ts", patch }],
    );
    expect(plan.event).toBe("REQUEST_CHANGES");
    expect(plan.comments).toHaveLength(1);
    expect(plan.comments[0]).toMatchObject({
      path: "a.ts",
      line: 3,
      side: "RIGHT",
    });
    expect(plan.body).toContain("R2");
    expect(plan.body).toContain("`a.ts:10`");
    expect(plan.body).toContain("R3");
  });

  test("a 422 on REQUEST_CHANGES falls back to COMMENT, then to no inline comments", async () => {
    const events: string[] = [];
    const client: Pick<GitHubClient, "createReview"> = {
      async createReview(_repo, _number, review) {
        events.push(`${review.event}:${review.comments.length}`);
        if (events.length < 3) throw new HttpError("422", 422, "");
      },
    };
    await postReview(client, "denizlg24/sprint-e2e", 4, SHA, {
      body: "b",
      event: "REQUEST_CHANGES",
      comments: [{ path: "a.ts", line: 3, side: "RIGHT", body: "x" }],
    });
    expect(events).toEqual(["REQUEST_CHANGES:1", "COMMENT:1", "COMMENT:0"]);
  });
});

describe("RunTokenSource", () => {
  test("mints through the API with an api-audience token and unwraps data", async () => {
    const calls: Array<{
      url: string;
      body: string;
      authorization: string | null;
    }> = [];
    const fetchImpl = async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.endsWith("/oauth2/token")) {
        return Response.json({ access_token: "machine", expires_in: 300 });
      }
      calls.push({
        url,
        body: String(init?.body),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json({
        data: {
          token: "ghs_run",
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          permissions: { contents: "read", pull_requests: "write" },
        },
      });
    };
    const tokens = new ServiceTokens(
      {
        issuer: "https://api.example/api/auth",
        clientId: "c",
        clientSecret: "s",
      },
      fetchImpl,
    );
    const source = new RunTokenSource(
      { url: "https://api.example", resource: "https://api.denizlg24.com" },
      tokens,
      fetchImpl,
    );
    const token = await source.get("denizlg24/sprint-e2e", "review");
    expect(token.token).toBe("ghs_run");
    await source.get("denizlg24/sprint-e2e", "review");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://api.example/api/deploy/github/run-token",
    );
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      repo: "denizlg24/sprint-e2e",
      kind: "review",
    });
    expect(calls[0]?.authorization).toBe("Bearer machine");
  });
});
