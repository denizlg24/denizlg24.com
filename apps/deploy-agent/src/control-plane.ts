import {
  type AgentDeploymentEnv,
  type AgentDeploymentRequest,
  agentClaimResponseSchema,
  agentDeploymentEnvSchema,
  type DeployModuleGraph,
  type DeploymentStatusUpdate,
} from "@repo/schemas/cloud";

export interface ControlPlaneClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class ControlPlaneError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ControlPlaneError";
    this.status = status;
  }
}

export class ControlPlaneClient {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ControlPlaneClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#token = options.token;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async #request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        authorization: `Bearer ${this.#token}`,
      },
      signal: init.signal ?? AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new ControlPlaneError(
        `${path} responded ${response.status}`,
        response.status,
      );
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async #post(path: string, body: unknown): Promise<unknown> {
    return this.#request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  /**
   * Returns null when there is nothing queued. The control plane does the
   * `FOR UPDATE SKIP LOCKED` claim and flips the row to `building`, so a
   * successful response here means the work is already assigned to us — a
   * crash between this call and the first status report leaves a row that the
   * interrupted-run sweep reclaims, not one that two agents both build.
   */
  async claim(): Promise<AgentDeploymentRequest | null> {
    const body = await this.#post("/api/deploy/agent/claim", {});
    return agentClaimResponseSchema.parse(body).deployment;
  }

  /**
   * Doubles as the heartbeat: the control plane refreshes `heartbeatAt` on
   * every status write, so a long build reporting its unchanged status is what
   * keeps the interrupted sweep off it.
   */
  async report(
    deploymentId: string,
    update: DeploymentStatusUpdate,
  ): Promise<void> {
    await this.#post(
      `/api/deploy/agent/deployments/${deploymentId}/status`,
      update,
    );
  }

  /**
   * Fetched once, immediately before the build, and never persisted by the
   * agent beyond the 0600 env file `docker run` reads and the pipeline
   * deletes. The request deliberately carries no env of its own, so a queued
   * row that outlives its build cannot leak one.
   */
  async env(
    deploymentId: string,
    signal?: AbortSignal,
  ): Promise<AgentDeploymentEnv> {
    const body = await this.#request(
      `/api/deploy/agent/deployments/${deploymentId}/env`,
      { method: "GET", signal },
    );
    return agentDeploymentEnvSchema.parse(body);
  }

  /**
   * What this checkout showed the target imports. Reported once per build,
   * right after the clone, so it lands whether or not the build then succeeds —
   * a failing build resolves the same graph a passing one does.
   */
  async reportModuleGraph(
    deploymentId: string,
    graph: DeployModuleGraph,
  ): Promise<void> {
    await this.#post(
      `/api/deploy/agent/deployments/${deploymentId}/module-graph`,
      { moduleGraph: graph },
    );
  }
}
