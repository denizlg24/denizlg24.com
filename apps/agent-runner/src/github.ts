import { chmod, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CodingRunCi,
  type Finding,
  type RunnerPrState,
  type RunTokenResponse,
  runTokenResponseSchema,
  type SprintSlotKind,
} from "@repo/schemas";
import { z } from "zod";
import type { RunnerConfig } from "./config";
import { errorFrom, type FetchLike, HttpError, sleep } from "./http";
import { authorizedFetch, type ServiceTokens } from "./oauth";

const GITHUB_API = "https://api.github.com";

// ── Run tokens ─────────────────────────────────────────────────────────────

export interface RunToken {
  token: string;
  expiresAt: number;
  permissions: Record<string, string>;
}

/** Repo-scoped installation tokens, minted by the cloud API for one kind. */
export class RunTokenSource {
  readonly #cached = new Map<string, RunToken>();

  constructor(
    private readonly api: RunnerConfig["api"],
    private readonly tokens: ServiceTokens,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async mint(repo: string, kind: SprintSlotKind): Promise<RunToken> {
    const response = await authorizedFetch(
      this.tokens,
      this.api.resource,
      `${this.api.url}/api/deploy/github/run-token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ repo, kind }),
      },
      this.fetchImpl,
    );
    if (!response.ok) throw await errorFrom(response, "Run token");
    const body = z
      .object({ data: runTokenResponseSchema })
      .parse(await response.json());
    const minted = toRunToken(body.data);
    this.#cached.set(`${repo}:${kind}`, minted);
    return minted;
  }

  /** A cached token with at least `minValidityMs` left, or a fresh one. */
  async get(
    repo: string,
    kind: SprintSlotKind,
    minValidityMs = 15 * 60_000,
  ): Promise<RunToken> {
    const cached = this.#cached.get(`${repo}:${kind}`);
    if (cached && cached.expiresAt - minValidityMs > this.now()) return cached;
    return this.mint(repo, kind);
  }
}

function toRunToken(response: RunTokenResponse): RunToken {
  return {
    token: response.token,
    expiresAt: Date.parse(response.expiresAt),
    permissions: response.permissions,
  };
}

export const TOKEN_REFRESH_MS = 45 * 60_000;
export const TOKEN_FILE_NAME = "github-token";

/**
 * The token a run's container reads through the credential helper and the
 * gh wrapper. Re-minted every 45 minutes so a six-hour run never holds an
 * expired one; written by rename so a reader never sees half a token.
 */
export class TokenFile {
  #current: RunToken | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly source: Pick<RunTokenSource, "mint">,
    private readonly repo: string,
    private readonly kind: SprintSlotKind,
    readonly dir: string,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  get path(): string {
    return join(this.dir, TOKEN_FILE_NAME);
  }

  token(): string {
    if (!this.#current) throw new Error("token file not started");
    return this.#current.token;
  }

  async start(): Promise<void> {
    await this.#refresh();
  }

  stop(): void {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }

  async #refresh(): Promise<void> {
    const minted = await this.source.mint(this.repo, this.kind);
    const temporary = `${this.path}.next`;
    await writeFile(temporary, minted.token, { mode: 0o644 });
    await chmod(temporary, 0o644);
    await rename(temporary, this.path);
    this.#current = minted;
    this.#schedule(TOKEN_REFRESH_MS);
  }

  #schedule(delay: number): void {
    this.#timer = setTimeout(() => {
      this.#refresh().catch((error: unknown) => {
        this.onError(error);
        this.#schedule(60_000);
      });
    }, delay);
    this.#timer.unref?.();
  }
}

// ── API client ─────────────────────────────────────────────────────────────

const pullSchema = z.object({
  number: z.number(),
  node_id: z.string(),
  html_url: z.string(),
  state: z.enum(["open", "closed"]),
  draft: z.boolean().optional(),
  merged: z.boolean().optional(),
  merged_at: z.string().nullable().optional(),
  merge_commit_sha: z.string().nullable().optional(),
  body: z.string().nullable().optional(),
  head: z.object({ sha: z.string() }),
});
export type Pull = z.infer<typeof pullSchema>;

const pullFileSchema = z.object({
  filename: z.string(),
  patch: z.string().optional(),
});

const checkRunsSchema = z.object({
  check_runs: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      html_url: z.string().nullable().optional(),
      details_url: z.string().nullable().optional(),
    }),
  ),
});
export type CheckRuns = z.infer<typeof checkRunsSchema>;

const combinedStatusSchema = z.object({
  statuses: z.array(
    z.object({
      context: z.string(),
      state: z.string(),
      target_url: z.string().nullable().optional(),
    }),
  ),
});
export type CombinedStatus = z.infer<typeof combinedStatusSchema>;

const branchRulesSchema = z.array(
  z
    .object({
      type: z.string(),
      parameters: z
        .object({
          required_status_checks: z
            .array(z.object({ context: z.string() }))
            .optional(),
        })
        .loose()
        .optional(),
    })
    .loose(),
);

const protectionChecksSchema = z.object({
  contexts: z.array(z.string()).optional(),
  checks: z.array(z.object({ context: z.string() })).optional(),
});

const mergeSchema = z.object({ sha: z.string(), merged: z.boolean() });

export interface ReviewComment {
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
}

export class GitHubClient {
  constructor(
    private readonly token: () => string | Promise<string>,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = GITHUB_API,
  ) {}

  async #request(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Response> {
    return this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${await this.token()}`,
        "x-github-api-version": "2022-11-28",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  }

  async #json<T>(
    schema: z.ZodType<T>,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.#request(method, path, body);
    if (!response.ok)
      throw await errorFrom(response, `GitHub ${method} ${path}`);
    return schema.parse(await response.json());
  }

  getPull(repo: string, number: number): Promise<Pull> {
    return this.#json(pullSchema, "GET", `/repos/${repo}/pulls/${number}`);
  }

  async findOpenPull(repo: string, branch: string): Promise<Pull | null> {
    const owner = repo.split("/")[0];
    const pulls = await this.#json(
      z.array(pullSchema),
      "GET",
      `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    );
    return pulls[0] ?? null;
  }

  createPull(
    repo: string,
    input: { title: string; head: string; base: string; body: string },
  ): Promise<Pull> {
    return this.#json(pullSchema, "POST", `/repos/${repo}/pulls`, {
      ...input,
      draft: true,
    });
  }

  updatePullBody(repo: string, number: number, body: string): Promise<Pull> {
    return this.#json(pullSchema, "PATCH", `/repos/${repo}/pulls/${number}`, {
      body,
    });
  }

  /** REST cannot leave draft; only GraphQL can. */
  async markReady(nodeId: string): Promise<void> {
    const response = await this.#request("POST", "/graphql", {
      query:
        "mutation($id: ID!) { markPullRequestReadyForReview(input: { pullRequestId: $id }) { pullRequest { isDraft } } }",
      variables: { id: nodeId },
    });
    if (!response.ok) throw await errorFrom(response, "GitHub mark ready");
    const body = z
      .object({ errors: z.array(z.object({ message: z.string() })).optional() })
      .loose()
      .parse(await response.json());
    const errors = body.errors ?? [];
    if (errors.length > 0) {
      throw new Error(
        `GitHub mark ready: ${errors.map((error) => error.message).join("; ")}`,
      );
    }
  }

  async pullFiles(
    repo: string,
    number: number,
  ): Promise<Array<z.infer<typeof pullFileSchema>>> {
    const files: Array<z.infer<typeof pullFileSchema>> = [];
    for (let page = 1; page <= 30; page += 1) {
      const batch = await this.#json(
        z.array(pullFileSchema),
        "GET",
        `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`,
      );
      files.push(...batch);
      if (batch.length < 100) break;
    }
    return files;
  }

  async createReview(
    repo: string,
    number: number,
    review: {
      commitId: string;
      body: string;
      event: "COMMENT" | "REQUEST_CHANGES";
      comments: ReviewComment[];
    },
  ): Promise<void> {
    const response = await this.#request(
      "POST",
      `/repos/${repo}/pulls/${number}/reviews`,
      {
        commit_id: review.commitId,
        body: review.body,
        event: review.event,
        comments: review.comments,
      },
    );
    if (!response.ok) throw await errorFrom(response, "GitHub review");
  }

  checkRuns(repo: string, sha: string): Promise<CheckRuns> {
    return this.#json(
      checkRunsSchema,
      "GET",
      `/repos/${repo}/commits/${sha}/check-runs?per_page=100`,
    );
  }

  combinedStatus(repo: string, sha: string): Promise<CombinedStatus> {
    return this.#json(
      combinedStatusSchema,
      "GET",
      `/repos/${repo}/commits/${sha}/status?per_page=100`,
    );
  }

  /**
   * Required check names from the branch's rulesets and classic protection.
   * Null when neither names any: every check then counts. Protection needs
   * administration access the run token never has, so its 403 is quiet.
   */
  async requiredChecks(repo: string, branch: string): Promise<string[] | null> {
    const names = new Set<string>();
    const encoded = encodeURIComponent(branch);
    const rules = await this.#request(
      "GET",
      `/repos/${repo}/rules/branches/${encoded}`,
    );
    if (rules.ok) {
      const parsed = branchRulesSchema.safeParse(await rules.json());
      for (const rule of parsed.success ? parsed.data : []) {
        if (rule.type !== "required_status_checks") continue;
        for (const check of rule.parameters?.required_status_checks ?? []) {
          names.add(check.context);
        }
      }
    }
    const protection = await this.#request(
      "GET",
      `/repos/${repo}/branches/${encoded}/protection/required_status_checks`,
    );
    if (protection.ok) {
      const parsed = protectionChecksSchema.safeParse(await protection.json());
      if (parsed.success) {
        for (const context of parsed.data.contexts ?? []) names.add(context);
        for (const check of parsed.data.checks ?? []) names.add(check.context);
      }
    }
    return names.size > 0 ? [...names] : null;
  }

  /** Merges exactly `sha`; GitHub refuses (409) if the head moved since. */
  async merge(
    repo: string,
    number: number,
    sha: string,
  ): Promise<{ ok: true; sha: string } | { ok: false; error: string }> {
    const response = await this.#request(
      "PUT",
      `/repos/${repo}/pulls/${number}/merge`,
      { sha },
    );
    if (!response.ok) {
      const error = await errorFrom(response, "GitHub merge");
      return { ok: false, error: error.message };
    }
    const body = mergeSchema.parse(await response.json());
    return body.merged
      ? { ok: true, sha: body.sha }
      : { ok: false, error: "GitHub did not merge" };
  }
}

export function pullState(pull: Pull): RunnerPrState {
  if (pull.merged || pull.merged_at) {
    return {
      state: "merged",
      mergeSha: pull.merge_commit_sha ?? undefined,
      mergedAt: pull.merged_at
        ? new Date(pull.merged_at).toISOString()
        : undefined,
    };
  }
  if (pull.state === "closed") return { state: "closed" };
  return { state: pull.draft ? "draft" : "open" };
}

// ── PR body ────────────────────────────────────────────────────────────────

const RUNS_START = "<!-- sprint-runs -->";
const RUNS_END = "<!-- /sprint-runs -->";
const RUNS_HEADER = "| Slot | Kind | Status | Summary |\n|---|---|---|---|";

function cell(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export interface RunRow {
  slot: string;
  kind: SprintSlotKind;
  status: string;
  summary: string;
}

export function runRow(row: RunRow): string {
  return `| ${cell(row.slot, 120)} | ${row.kind} | ${cell(row.status, 40)} | ${cell(row.summary)} |`;
}

export function initialPullBody(goal: string, row: RunRow): string {
  const intro = goal.trim() || "Sprint branch.";
  return `${intro}\n\n${RUNS_START}\n${RUNS_HEADER}\n${runRow(row)}\n${RUNS_END}\n`;
}

/** Adds a row to the run table, creating the table when the body lost it. */
export function appendRunRow(body: string, row: RunRow): string {
  const end = body.indexOf(RUNS_END);
  if (body.includes(RUNS_START) && end !== -1) {
    const before = body.slice(0, end).replace(/\n*$/, "\n");
    return `${before}${runRow(row)}\n${body.slice(end)}`;
  }
  const trimmed = body.trimEnd();
  return `${trimmed ? `${trimmed}\n\n` : ""}${RUNS_START}\n${RUNS_HEADER}\n${runRow(row)}\n${RUNS_END}\n`;
}

// ── Review ─────────────────────────────────────────────────────────────────

/** New-side line numbers a review comment may target in one file's patch. */
export function commentableLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let next = 0;
  for (const line of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk?.[1]) {
      next = Number(hunk[1]);
      continue;
    }
    if (next === 0) continue;
    if (line.startsWith("+") || line.startsWith(" ")) {
      lines.add(next);
      next += 1;
    }
  }
  return lines;
}

function findingText(finding: Finding): string {
  return `**${finding.severity}** ${finding.id}: ${finding.title}\n\n${finding.detail}`.trim();
}

export interface ReviewPlan {
  body: string;
  event: "COMMENT" | "REQUEST_CHANGES";
  comments: ReviewComment[];
}

export function planReview(
  result: {
    summary: string;
    verdict: "approve" | "changes";
    findings: Finding[];
  },
  files: Array<{ filename: string; patch?: string }>,
): ReviewPlan {
  const commentable = new Map(
    files.map((file) => [file.filename, commentableLines(file.patch ?? "")]),
  );
  const comments: ReviewComment[] = [];
  const general: Finding[] = [];
  for (const finding of result.findings) {
    const lines = finding.file ? commentable.get(finding.file) : undefined;
    if (finding.file && finding.line && lines?.has(finding.line)) {
      comments.push({
        path: finding.file,
        line: finding.line,
        side: "RIGHT",
        body: findingText(finding),
      });
    } else {
      general.push(finding);
    }
  }
  const parts = [
    `**Verdict: ${result.verdict}**`,
    result.summary,
    ...general.map((finding) => {
      const where = finding.file
        ? ` (\`${finding.file}${finding.line ? `:${finding.line}` : ""}\`)`
        : "";
      return `- ${findingText(finding).replace("\n\n", `${where}\n  `)}`;
    }),
  ];
  return {
    body: parts.join("\n\n"),
    event: result.verdict === "changes" ? "REQUEST_CHANGES" : "COMMENT",
    comments,
  };
}

/**
 * Posts one review. GitHub refuses REQUEST_CHANGES on a PR its own author
 * opened, and the app both opens the PR and reviews it, so a 422 drops to a
 * COMMENT; a second 422 (a line that no longer resolves) moves every inline
 * comment into the body.
 */
export async function postReview(
  client: Pick<GitHubClient, "createReview">,
  repo: string,
  number: number,
  commitId: string,
  plan: ReviewPlan,
): Promise<void> {
  const attempts: ReviewPlan[] = [
    plan,
    { ...plan, event: "COMMENT" },
    {
      event: "COMMENT",
      comments: [],
      body: [
        plan.body,
        ...plan.comments.map(
          (comment) => `- \`${comment.path}:${comment.line}\` ${comment.body}`,
        ),
      ].join("\n\n"),
    },
  ];
  let lastError: unknown = null;
  for (const attempt of attempts) {
    try {
      await client.createReview(repo, number, { commitId, ...attempt });
      return;
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 422) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

// ── CI ─────────────────────────────────────────────────────────────────────

export type CheckState = "pending" | "success" | "failure";

export interface ChecksEvaluation {
  state: CheckState | "none";
  failing: Array<{ name: string; url?: string }>;
  url?: string;
}

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function isHttpUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^https?:\/\//.test(value);
}

/**
 * The verdict of everything that reported on one sha. With `required` set
 * only those names count, and a required check that has not reported yet is
 * pending; without it every reported check counts.
 */
export function evaluateChecks(
  runs: CheckRuns,
  status: CombinedStatus,
  required: string[] | null,
): ChecksEvaluation {
  const entries = new Map<
    string,
    { state: CheckState; url?: string; id: number }
  >();
  for (const run of runs.check_runs) {
    const previous = entries.get(run.name);
    if (previous && previous.id > run.id) continue;
    const state: CheckState =
      run.status !== "completed"
        ? "pending"
        : PASSING_CONCLUSIONS.has(run.conclusion ?? "")
          ? "success"
          : "failure";
    const url = run.html_url ?? run.details_url;
    entries.set(run.name, {
      state,
      url: isHttpUrl(url) ? url : undefined,
      id: run.id,
    });
  }
  for (const item of status.statuses) {
    if (entries.has(item.context)) continue;
    const state: CheckState =
      item.state === "success"
        ? "success"
        : item.state === "pending"
          ? "pending"
          : "failure";
    entries.set(item.context, {
      state,
      url: isHttpUrl(item.target_url) ? item.target_url : undefined,
      id: 0,
    });
  }
  const considered = required
    ? required.map(
        (name) =>
          [
            name,
            entries.get(name) ?? { state: "pending" as const, id: 0 },
          ] as const,
      )
    : [...entries.entries()];
  if (considered.length === 0) return { state: "none", failing: [] };
  const failing = considered
    .filter(([, entry]) => entry.state === "failure")
    .map(([name, entry]) => ({ name, url: entry.url }));
  const firstUrl = considered.find(([, entry]) => entry.url)?.[1].url;
  if (failing.length > 0)
    return { state: "failure", failing, url: failing[0]?.url };
  if (considered.some(([, entry]) => entry.state === "pending")) {
    return { state: "pending", failing: [], url: firstUrl };
  }
  return { state: "success", failing: [], url: firstUrl };
}

export interface CiWaitOptions {
  client: Pick<GitHubClient, "checkRuns" | "combinedStatus" | "requiredChecks">;
  repo: string;
  sha: string;
  baseBranch: string;
  ciRequired: boolean;
  intervalMs?: number;
  timeoutMs?: number;
  /** Checks register a moment after the push; the first look waits this long. */
  graceMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cancelled?: () => boolean;
}

export type CiWaitOutcome =
  | { kind: "success"; ci: CodingRunCi }
  | { kind: "failure"; ci: CodingRunCi; message: string }
  | { kind: "timeout"; ci: CodingRunCi; message: string }
  | { kind: "cancelled" };

export async function waitForCi(
  options: CiWaitOptions,
): Promise<CiWaitOutcome> {
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;
  const interval = options.intervalMs ?? 60_000;
  const deadline = now() + (options.timeoutMs ?? 60 * 60_000);
  const required = await options.client
    .requiredChecks(options.repo, options.baseBranch)
    .catch(() => null);
  await wait(options.graceMs ?? 30_000);
  let last: ChecksEvaluation = { state: "none", failing: [] };
  while (true) {
    if (options.cancelled?.()) return { kind: "cancelled" };
    const [runs, status] = await Promise.all([
      options.client.checkRuns(options.repo, options.sha),
      options.client.combinedStatus(options.repo, options.sha),
    ]);
    last = evaluateChecks(runs, status, required);
    const checkedAt = new Date(now()).toISOString();
    if (
      last.state === "success" ||
      (last.state === "none" && !options.ciRequired)
    ) {
      return {
        kind: "success",
        ci: { state: "success", checkedAt, url: last.url },
      };
    }
    if (last.state === "failure") {
      return {
        kind: "failure",
        ci: {
          state: "failure",
          checkedAt,
          url: last.url,
          failing: last.failing.slice(0, 50),
        },
        message: `CI failed: ${last.failing
          .map((check) =>
            check.url ? `${check.name} (${check.url})` : check.name,
          )
          .join(", ")}`,
      };
    }
    if (now() + interval > deadline) {
      return {
        kind: "timeout",
        ci: { state: "pending", checkedAt, url: last.url },
        message:
          last.state === "none"
            ? "No checks reported on the release commit within 60 minutes"
            : "CI did not finish within 60 minutes",
      };
    }
    await wait(interval);
  }
}
