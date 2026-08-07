import {
  type AgentDeploymentRequest,
  agentClaimResponseSchema,
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

  async #post(path: string, body: unknown): Promise<unknown> {
    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.#token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
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
}
