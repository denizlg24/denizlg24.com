import { optionalEnv, requiredEnv } from "../../env";
import { createAppJwt, readGithubPrivateKey } from "./jwt";

export const GITHUB_API_BASE = "https://api.github.com";

export interface GithubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
  /**
   * Only ever used to build the install link the UI sends the browser to.
   * Optional because every API call authenticates with the app id and key —
   * an unset slug costs the "Connect GitHub" button, not any functionality.
   */
  slug: string | null;
}

export function githubAppConfigFromEnv(): GithubAppConfig {
  return {
    appId: requiredEnv("GITHUB_APP_ID"),
    // Read once here so a malformed key fails at boot rather than on the first
    // webhook, when the only symptom is a build that never starts.
    privateKey: readGithubPrivateKey(requiredEnv("GITHUB_APP_PRIVATE_KEY")),
    webhookSecret: requiredEnv("GITHUB_APP_WEBHOOK_SECRET"),
    slug: optionalEnv("GITHUB_APP_SLUG", "").trim() || null,
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
  conclusion?: "success" | "failure" | "cancelled" | "neutral" | "skipped";
  detailsUrl?: string;
  output?: { title: string; summary: string };
}

export interface GithubRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  pushedAt: string | null;
}

export interface GithubInstallation {
  id: number;
  accountLogin: string;
  accountType: string;
  repositorySelection: string;
  suspendedAt: string | null;
}

export interface GithubBranch {
  name: string;
  sha: string;
}

export interface GithubChangedFiles {
  /** New and previous names are both present when a file was renamed. */
  paths: string[];
  /** False means GitHub hit its comparison file limit or returned bad data. */
  complete: boolean;
}

export interface GithubTreeEntry {
  path: string;
  name: string;
  type: "file" | "dir";
}

/**
 * Five minutes of headroom on a one-hour token. A clone that starts at minute
 * 59 with a token about to expire fails mid-fetch, which surfaces as a build
 * failure with a git error and nothing pointing at the token.
 */
const TOKEN_EXPIRY_SKEW_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 15_000;

const PER_PAGE = 100;
/** GitHub truncates the changed-file list here and offers no next page. */
export const GITHUB_COMPARE_FILE_LIMIT = 300;

export function installationTokenKey(installationId: number): string {
  return `forge:gh:inst:${installationId}`;
}

/**
 * An empty path has to drop the trailing slash: `/contents/` 404s where
 * `/contents` lists the repository root.
 */
function contentsPath(
  owner: string,
  repo: string,
  path: string,
  ref?: string,
): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  const encoded = clean
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : "";
  return `/repos/${owner}/${repo}/contents${encoded ? `/${encoded}` : ""}${query}`;
}

function readInstallation(value: unknown): GithubInstallation | null {
  if (value === null || typeof value !== "object") return null;
  const installation = value as Record<string, unknown>;
  if (typeof installation.id !== "number") return null;
  const account = installation.account;
  const read = (key: string): string | null => {
    if (account === null || typeof account !== "object") return null;
    const found = (account as Record<string, unknown>)[key];
    return typeof found === "string" ? found : null;
  };
  return {
    id: installation.id,
    accountLogin: read("login") ?? "unknown",
    accountType: read("type") ?? "unknown",
    repositorySelection:
      typeof installation.repository_selection === "string"
        ? installation.repository_selection
        : "selected",
    suspendedAt:
      typeof installation.suspended_at === "string"
        ? installation.suspended_at
        : null,
  };
}

function readRepository(value: unknown): GithubRepository | null {
  if (value === null || typeof value !== "object") return null;
  const repository = value as Record<string, unknown>;
  const owner = repository.owner;
  const login =
    owner !== null && typeof owner === "object" && "login" in owner
      ? owner.login
      : null;
  if (
    typeof repository.id !== "number" ||
    typeof repository.name !== "string" ||
    typeof login !== "string"
  ) {
    return null;
  }
  return {
    id: repository.id,
    owner: login,
    name: repository.name,
    fullName:
      typeof repository.full_name === "string"
        ? repository.full_name
        : `${login}/${repository.name}`,
    private: repository.private === true,
    defaultBranch:
      typeof repository.default_branch === "string"
        ? repository.default_branch
        : "main",
    pushedAt:
      typeof repository.pushed_at === "string" ? repository.pushed_at : null,
  };
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

  /** `null` for 404 rather than a throw, for the paths where absence is an answer. */
  async #maybeJson<T>(
    path: string,
    init: RequestInit & { token: string },
  ): Promise<T | null> {
    try {
      return await this.#json<T>(path, init);
    } catch (error) {
      if (error instanceof GithubApiError && error.status === 404) return null;
      throw error;
    }
  }

  /**
   * Pages until short, capped: an installation with thousands of repositories
   * would otherwise hold the request open for as many round trips as it takes.
   * The picker searches client-side over what this returns, so the cap is the
   * ceiling on what is findable, not a page size.
   */
  async #paged<T>(
    build: (page: number) => string,
    init: { token: string },
    read: (body: unknown) => T[],
    maxPages = 10,
  ): Promise<T[]> {
    const collected: T[] = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const body = await this.#json<unknown>(build(page), {
        method: "GET",
        token: init.token,
      });
      const items = read(body);
      collected.push(...items);
      if (items.length < PER_PAGE) break;
    }
    return collected;
  }

  /**
   * Every installation of this App, read with the App JWT rather than an
   * installation token.
   *
   * This is the only way to learn about an installation without a webhook, and
   * that matters twice: locally, where the App's webhook necessarily points at
   * the deployed API and nothing reaches a laptop, and in production, where a
   * webhook delivered while the container was restarting is otherwise lost
   * with no way back other than reinstalling the App.
   */
  async listInstallations(): Promise<GithubInstallation[]> {
    const jwt = createAppJwt({
      appId: this.#config.appId,
      privateKey: this.#config.privateKey,
      now: this.#now,
    });
    return this.#paged<GithubInstallation>(
      (page) => `/app/installations?per_page=${PER_PAGE}&page=${page}`,
      { token: jwt },
      (body) =>
        (Array.isArray(body) ? body : []).flatMap((entry) => {
          const installation = readInstallation(entry);
          return installation ? [installation] : [];
        }),
    );
  }

  async listRepositories(installationId: number): Promise<GithubRepository[]> {
    const token = await this.installationToken(installationId);
    return this.#paged<GithubRepository>(
      (page) => `/installation/repositories?per_page=${PER_PAGE}&page=${page}`,
      { token },
      (body) => {
        const repositories =
          body !== null &&
          typeof body === "object" &&
          "repositories" in body &&
          Array.isArray(body.repositories)
            ? body.repositories
            : [];
        return repositories.flatMap((entry) => {
          const repository = readRepository(entry);
          return repository ? [repository] : [];
        });
      },
    );
  }

  async listBranches(input: {
    installationId: number;
    owner: string;
    repo: string;
  }): Promise<GithubBranch[]> {
    const token = await this.installationToken(input.installationId);
    return this.#paged<GithubBranch>(
      (page) =>
        `/repos/${input.owner}/${input.repo}/branches?per_page=${PER_PAGE}&page=${page}`,
      { token },
      (body) =>
        (Array.isArray(body) ? body : []).flatMap((entry) => {
          if (entry === null || typeof entry !== "object") return [];
          const branch = entry as { name?: unknown; commit?: unknown };
          if (typeof branch.name !== "string") return [];
          const sha =
            branch.commit !== null &&
            typeof branch.commit === "object" &&
            "sha" in branch.commit &&
            typeof branch.commit.sha === "string"
              ? branch.commit.sha
              : "";
          return [{ name: branch.name, sha }];
        }),
    );
  }

  /**
   * One level, not a recursive tree: the browser walks down a directory at a
   * time, and `git/trees?recursive=1` on a large repository returns megabytes
   * to render one folder.
   */
  async listDirectory(input: {
    installationId: number;
    owner: string;
    repo: string;
    path: string;
    ref?: string;
  }): Promise<GithubTreeEntry[] | null> {
    const token = await this.installationToken(input.installationId);
    const body = await this.#maybeJson<unknown>(
      contentsPath(input.owner, input.repo, input.path, input.ref),
      { method: "GET", token },
    );
    if (!Array.isArray(body)) return null;
    return body.flatMap((entry) => {
      if (entry === null || typeof entry !== "object") return [];
      const item = entry as { path?: unknown; name?: unknown; type?: unknown };
      if (typeof item.path !== "string" || typeof item.name !== "string") {
        return [];
      }
      if (item.type !== "file" && item.type !== "dir") return [];
      return [{ path: item.path, name: item.name, type: item.type }];
    });
  }

  /**
   * `null` covers both "not there" and "there but not readable as text" —
   * detection treats an unreadable manifest exactly as it treats a missing
   * one, so distinguishing them would only give the caller a branch to ignore.
   * Files over the Contents API's 1 MB inline limit come back with an empty
   * body, which lands here as null; nothing detection reads approaches that.
   */
  async readFile(input: {
    installationId: number;
    owner: string;
    repo: string;
    path: string;
    ref?: string;
  }): Promise<string | null> {
    const token = await this.installationToken(input.installationId);
    const body = await this.#maybeJson<unknown>(
      contentsPath(input.owner, input.repo, input.path, input.ref),
      { method: "GET", token },
    );
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return null;
    }
    const file = body as { content?: unknown; encoding?: unknown };
    if (file.encoding !== "base64" || typeof file.content !== "string") {
      return null;
    }
    try {
      return Buffer.from(file.content, "base64").toString("utf8");
    } catch {
      return null;
    }
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

  /**
   * The files between two immutable commits. A result at GitHub's hard limit is
   * marked incomplete so callers can deploy conservatively instead of treating
   * an absent path as proof that it did not change.
   */
  async compareFiles(input: {
    installationId: number;
    owner: string;
    repo: string;
    base: string;
    head: string;
  }): Promise<GithubChangedFiles> {
    const token = await this.installationToken(input.installationId);
    const basehead = `${encodeURIComponent(input.base)}...${encodeURIComponent(input.head)}`;
    const body = await this.#json<unknown>(
      `/repos/${input.owner}/${input.repo}/compare/${basehead}?per_page=1`,
      { method: "GET", token },
    );
    if (body === null || typeof body !== "object" || !("files" in body)) {
      return { paths: [], complete: false };
    }
    const rawFiles = (body as { files?: unknown }).files;
    if (!Array.isArray(rawFiles)) return { paths: [], complete: false };

    const paths = new Set<string>();
    let malformed = false;
    for (const value of rawFiles) {
      if (value === null || typeof value !== "object") {
        malformed = true;
        continue;
      }
      const file = value as {
        filename?: unknown;
        previous_filename?: unknown;
      };
      if (typeof file.filename !== "string") {
        malformed = true;
        continue;
      }
      paths.add(file.filename);
      if (typeof file.previous_filename === "string") {
        paths.add(file.previous_filename);
      }
    }

    return {
      paths: [...paths],
      complete: !malformed && rawFiles.length < GITHUB_COMPARE_FILE_LIMIT,
    };
  }

  /**
   * Created `in_progress` unless `completed` is given. A skipped build has
   * nothing to wait for, and a check run that appears and finishes in one call
   * never leaves a spinner on a commit nobody is building.
   */
  async createCheckRun(input: {
    installationId: number;
    owner: string;
    repo: string;
    name: string;
    headSha: string;
    detailsUrl: string;
    completed?: {
      conclusion: NonNullable<GithubCheckRunUpdate["conclusion"]>;
      output: NonNullable<GithubCheckRunUpdate["output"]>;
    };
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
          details_url: input.detailsUrl,
          ...(input.completed
            ? {
                status: "completed",
                conclusion: input.completed.conclusion,
                output: input.completed.output,
                completed_at: new Date().toISOString(),
              }
            : { status: "in_progress" }),
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
