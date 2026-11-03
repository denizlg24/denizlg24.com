import {
  type RunnerClaimRequest,
  type RunnerClaimResponse,
  type RunnerCompleteRequestInput,
  type RunnerEventsRequest,
  type RunnerHeartbeatResponse,
  type RunnerMergeResult,
  type RunnerPrState,
  type RunnerStartRequest,
  runnerClaimResponseSchema,
  runnerHeartbeatResponseSchema,
} from "@repo/schemas";
import type { RunnerConfig } from "./config";
import { errorFrom, type FetchLike } from "./http";
import { authorizedFetch, type ServiceTokens } from "./oauth";

/** The runner's side of `/api/admin/sprints/runner/*` on web. */
export interface RunnerWebApi {
  claim(request: RunnerClaimRequest): Promise<RunnerClaimResponse>;
  start(runId: string, request: RunnerStartRequest): Promise<void>;
  heartbeat(runId: string): Promise<RunnerHeartbeatResponse>;
  events(runId: string, request: RunnerEventsRequest): Promise<void>;
  complete(runId: string, request: RunnerCompleteRequestInput): Promise<void>;
  mergeResult(sprintId: string, result: RunnerMergeResult): Promise<void>;
  prState(sprintId: string, state: RunnerPrState): Promise<void>;
}

/** Tolerates a `{ data }` envelope, which the cloud API uses and web may adopt. */
function unwrapData(body: unknown): unknown {
  if (
    typeof body === "object" &&
    body !== null &&
    "data" in body &&
    Object.keys(body).length === 1
  ) {
    return body.data;
  }
  return body;
}

export class WebClient implements RunnerWebApi {
  constructor(
    private readonly web: RunnerConfig["web"],
    private readonly tokens: ServiceTokens,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async claim(request: RunnerClaimRequest): Promise<RunnerClaimResponse> {
    const body = await this.#post("claim", request, "Claim");
    return runnerClaimResponseSchema.parse(unwrapData(body));
  }

  async start(runId: string, request: RunnerStartRequest): Promise<void> {
    await this.#post(
      `runs/${encodeURIComponent(runId)}/start`,
      request,
      "Start",
    );
  }

  /**
   * A run web no longer knows is answered as not live: the container is
   * stopped rather than left running against a lease nobody holds.
   */
  async heartbeat(runId: string): Promise<RunnerHeartbeatResponse> {
    const response = await this.#send(
      `runs/${encodeURIComponent(runId)}/heartbeat`,
      {},
    );
    if (response.status === 404 || response.status === 410) {
      return { cancelRequested: false, live: false };
    }
    if (!response.ok) throw await errorFrom(response, "Heartbeat");
    return runnerHeartbeatResponseSchema.parse(
      unwrapData(await response.json()),
    );
  }

  async events(runId: string, request: RunnerEventsRequest): Promise<void> {
    await this.#post(
      `runs/${encodeURIComponent(runId)}/events`,
      request,
      "Events",
    );
  }

  async complete(
    runId: string,
    request: RunnerCompleteRequestInput,
  ): Promise<void> {
    await this.#post(
      `runs/${encodeURIComponent(runId)}/complete`,
      request,
      "Complete",
    );
  }

  async mergeResult(
    sprintId: string,
    result: RunnerMergeResult,
  ): Promise<void> {
    await this.#post(
      `sprints/${encodeURIComponent(sprintId)}/merge-result`,
      result,
      "Merge result",
    );
  }

  async prState(sprintId: string, state: RunnerPrState): Promise<void> {
    await this.#post(
      `sprints/${encodeURIComponent(sprintId)}/pr-state`,
      state,
      "PR state",
    );
  }

  async #send(path: string, body: unknown): Promise<Response> {
    return authorizedFetch(
      this.tokens,
      this.web.resource,
      `${this.web.url}/api/admin/sprints/runner/${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      this.fetchImpl,
    );
  }

  async #post(path: string, body: unknown, what: string): Promise<unknown> {
    const response = await this.#send(path, body);
    if (!response.ok) throw await errorFrom(response, what);
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
}
