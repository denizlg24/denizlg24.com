import { requiredEnv } from "../../env";
import { createAppJwt, readGithubPrivateKey } from "./jwt";

export const GITHUB_API_BASE = "https://api.github.com";

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export function githubAppConfigFromEnv(): GithubAppConfig {
  return {
    appId: requiredEnv("GITHUB_APP_ID"),
    // Read once here so a malformed key fails at boot rather than on the first
    // webhook, when the only symptom is a build that never starts.
    privateKey: readGithubPrivateKey(requiredEnv("GITHUB_APP_PRIVATE_KEY")),
    webhookSecret: requiredEnv("GITHUB_APP_WEBHOOK_SECRET"),
  };
}

/** Just enough of Redis to cache a token; anything with a TTL will do. */
export interface TokenCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class GithubApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "GithubApiError";
    this.status = status;
  }
}

export interface GithubAppClientOptions {
  config: GithubAppConfig;
  cache: TokenCache;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

export interface GithubCommit {
  sha: string;
  message: string | null;
}

export interface GithubCheckRunUpdate {
  status?: "queued" | "in_progress" | "completed";
  conclusion?: "success" | "failure" | "cancelled" | "neutral";
  detailsUrl?: string;
  output?: { title: string; summary: string };
}

/**
 * Five minutes of headroom on a one-hour token. A clone that starts at minute
 * 59 with a token about to expire fails mid-fetch, which surfaces as a build
 * failure with a git error and nothing pointing at the token.
 */
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;

export function installationTokenKey(installationId: number): string {
  return `forge:gh:inst:${installationId}`;
}

export class GithubAppClient {
  readonly #config: GithubAppConfig;
  readonly #cache: TokenCache;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;

  constructor(options: GithubAppClientOptions) {
    this.#config = options.config;
    this.#cache = options.cache;
    this.#baseUrl = (options.baseUrl ?? GITHUB_API_BASE).replace(/\/+$/, "");
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  get webhookSecret(): string {
    return this.#config.webhookSecret;
  }

  async #request(
    path: string,
    init: RequestInit & { token: string },
  ): Promise<{ status: number; body: unknown }> {
    const { token, ...rest } = init;
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...rest,
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "forge-deploy",
        ...(rest.body === undefined
          ? {}
          : { "content-type": "application/json" }),
        ...(rest.headers as Record<string, string> | undefined),
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  }

  async #json<T>(
    path: string,
    init: RequestInit & { token: string },
  ): Promise<T> {
    const { status, body } = await this.#request(path, init);
    if (status >= 400) {
      const message =
        body !== null &&
        typeof body === "object" &&
        "message" in body &&
        typeof body.message === "string"
          ? body.message
          : `GitHub returned ${status}`;
      throw new GithubApiError(message, status);
    }
    return body as T;
  }

  /**
   * Cached in Redis rather than in memory: the token is per installation, not
   * per process, and minting one costs a signed round trip that every preview
   * push would otherwise pay.
   */
  async installationToken(installationId: number): Promise<string> {
    const key = installationTokenKey(installationId);
    const cached = await this.#cache.get(key).catch(() => null);
    if (cached) return cached;

    const jwt = createAppJwt({
      appId: this.#config.appId,
      privateKey: this.#config.privateKey,
      now: this.#now,
    });
    const minted = await this.#json<{ token: string; expires_at: string }>(
      `/app/installations/${installationId}/access_tokens`,
      { method: "POST", token: jwt },
    );
    const expiresAt = Date.parse(minted.expires_at);
    const ttlSeconds = Math.floor(
      (expiresAt - this.#now() - TOKEN_EXPIRY_SKEW_MS) / 1_000,
    );
    if (Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      await this.#cache.set(key, minted.token, ttlSeconds).catch(() => {});
    }
    return minted.token;
  }

  /** Forces the next call to mint a fresh one, after a 401 from a cached token. */
  async forgetInstallationToken(installationId: number): Promise<void> {
    await this.#cache
      .delete(installationTokenKey(installationId))
      .catch(() => {});
  }

  async resolveCommit(input: {
    installationId: number;
    owner: string;
    repo: string;
    ref: string;
  }): Promise<GithubCommit> {
    const token = await this.installationToken(input.installationId);
    const commit = await this.#json<{
      sha: string;
      commit?: { message?: string };
    }>(
      `/repos/${input.owner}/${input.repo}/commits/${encodeURIComponent(input.ref)}`,
      { method: "GET", token },
    );
    return { sha: commit.sha, message: commit.commit?.message ?? null };
  }

  async createCheckRun(input: {
    installationId: number;
    owner: string;
    repo: string;
    name: string;
    headSha: string;
    detailsUrl: string;
  }): Promise<number> {
    const token = await this.installationToken(input.installationId);
    const run = await this.#json<{ id: number }>(
      `/repos/${input.owner}/${input.repo}/check-runs`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          name: input.name,
          head_sha: input.headSha,
          status: "in_progress",
          details_url: input.detailsUrl,
        }),
      },
    );
    return run.id;
  }

  async updateCheckRun(input: {
    installationId: number;
    owner: string;
    repo: string;
    checkRunId: number;
    update: GithubCheckRunUpdate;
  }): Promise<void> {
    const token = await this.installationToken(input.installationId);
    await this.#json(
      `/repos/${input.owner}/${input.repo}/check-runs/${input.checkRunId}`,
      {
        method: "PATCH",
        token,
        body: JSON.stringify({
          ...(input.update.status ? { status: input.update.status } : {}),
          ...(input.update.conclusion
            ? { conclusion: input.update.conclusion }
            : {}),
          ...(input.update.detailsUrl
            ? { details_url: input.update.detailsUrl }
            : {}),
          ...(input.update.output ? { output: input.update.output } : {}),
        }),
      },
    );
  }

  /**
   * `required_contexts: []` is mandatory. Omit it and GitHub requires every
   * existing commit status to be green first, so on any repository with CI the
   * create returns 409 and the environment box silently never appears.
   * `auto_merge: false` for the neighbouring trap: GitHub may otherwise merge
   * the base branch into the ref and hand back a different SHA than the one
   * being built.
   */
  async createDeployment(input: {
    installationId: number;
    owner: string;
    repo: string;
    sha: string;
    environment: string;
    transient: boolean;
    production: boolean;
    description?: string;
  }): Promise<number> {
    const token = await this.installationToken(input.installationId);
    const deployment = await this.#json<{ id: number }>(
      `/repos/${input.owner}/${input.repo}/deployments`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          ref: input.sha,
          environment: input.environment,
          transient_environment: input.transient,
          production_environment: input.production,
          auto_merge: false,
          required_contexts: [],
          ...(input.description ? { description: input.description } : {}),
        }),
      },
    );
    return deployment.id;
  }

  async createDeploymentStatus(input: {
    installationId: number;
    owner: string;
    repo: string;
    deploymentId: number;
    state: "in_progress" | "success" | "failure" | "error" | "inactive";
    environmentUrl?: string;
    logUrl?: string;
  }): Promise<void> {
    const token = await this.installationToken(input.installationId);
    await this.#json(
      `/repos/${input.owner}/${input.repo}/deployments/${input.deploymentId}/statuses`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          state: input.state,
          ...(input.environmentUrl
            ? { environment_url: input.environmentUrl }
            : {}),
          ...(input.logUrl ? { log_url: input.logUrl } : {}),
        }),
      },
    );
  }

  /**
   * One comment per target, edited in place. A thread of near-identical
   * comments is what every re-push produces otherwise, and the marker is how
   * this finds its own comment without storing an id per pull request.
   */
  async upsertIssueComment(input: {
    installationId: number;
    owner: string;
    repo: string;
    issueNumber: number;
    marker: string;
    body: string;
  }): Promise<void> {
    const token = await this.installationToken(input.installationId);
    const existing = await this.#json<{ id: number; body?: string }[]>(
      `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments?per_page=100`,
      { method: "GET", token },
    );
    const mine = existing.find((comment) =>
      comment.body?.includes(input.marker),
    );
    const body = JSON.stringify({ body: input.body });
    if (mine) {
      await this.#json(
        `/repos/${input.owner}/${input.repo}/issues/comments/${mine.id}`,
        { method: "PATCH", token, body },
      );
      return;
    }
    await this.#json(
      `/repos/${input.owner}/${input.repo}/issues/${input.issueNumber}/comments`,
      { method: "POST", token, body },
    );
  }
}
