export interface DockerPing {
  version: string;
  containersRunning: number;
}

export type FetchLike = (
  input: string,
  init?: RequestInit & { unix?: string },
) => Promise<Response>;

export interface DockerClientOptions {
  socketPath: string;
  timeoutMs?: number;
  fetchImplementation?: FetchLike;
}

const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Talks to the daemon over its unix socket directly. There is no socket proxy
 * here, unlike the Pi: the agent runs on the host it deploys to, and a proxy
 * that allowed image builds would allow everything anyway.
 */
export class DockerClient {
  readonly #socketPath: string;
  readonly #timeoutMs: number;
  readonly #fetch: FetchLike;

  constructor(options: DockerClientOptions) {
    this.#socketPath = options.socketPath;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? (fetch as FetchLike);
  }

  async #request(path: string): Promise<Response> {
    const response = await this.#fetch(`http://localhost${path}`, {
      unix: this.#socketPath,
      signal: AbortSignal.timeout(this.#timeoutMs),
    });
    if (!response.ok) {
      throw new Error(
        `Docker ${path} responded ${response.status} ${response.statusText}`,
      );
    }
    return response;
  }

  /**
   * `/info` rather than `/_ping`, because a ping proves the socket answers and
   * nothing more. Every build needs the daemon to actually report its state,
   * and a daemon mid-restart answers the ping while failing that.
   */
  async ping(): Promise<DockerPing> {
    const response = await this.#request("/info");
    const body: unknown = await response.json();
    if (typeof body !== "object" || body === null) {
      throw new Error("Docker /info returned a non-object body");
    }
    const info = body as {
      ServerVersion?: unknown;
      ContainersRunning?: unknown;
    };
    return {
      version:
        typeof info.ServerVersion === "string" ? info.ServerVersion : "unknown",
      containersRunning:
        typeof info.ContainersRunning === "number" ? info.ContainersRunning : 0,
    };
  }
}
