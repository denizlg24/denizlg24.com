export interface DeployAgentProxyOptions {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Headers a proxy must not forward. `content-length` is in here because the
 * upstream body is re-emitted as a stream and a stale length truncates it.
 */
const HOP_BY_HOP = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export class DeployAgentUnavailableError extends Error {
  constructor(cause: unknown) {
    super("The deploy agent is unreachable");
    this.name = "DeployAgentUnavailableError";
    this.cause = cause;
  }
}

/**
 * Modelled on the terminal proxy, with one rule carried over from
 * `packages/cloud-core/src/middleware/cors.ts`: nothing on this path may read
 * `c.res` before `await next()`. Hono rebuilds the response when you do, which
 * converts the SSE body into a different stream and makes a build log buffer
 * instead of tailing.
 */
export class DeployAgentProxy {
  readonly #baseUrl: string;
  readonly #token: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: DeployAgentProxyOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#token = options.token;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImplementation ?? fetch;
  }

  async #call(
    path: string,
    init: RequestInit & { stream?: boolean; timeoutMs?: number },
  ): Promise<Response> {
    const { stream, timeoutMs, ...rest } = init;
    try {
      return await this.#fetch(`${this.#baseUrl}${path}`, {
        ...rest,
        headers: {
          ...(rest.headers as Record<string, string> | undefined),
          authorization: `Bearer ${this.#token}`,
        },
        // A build log has no length and no deadline. Aborting it on the
        // request timeout would cut the stream off mid-build, which is
        // precisely when someone is watching it.
        signal: stream
          ? undefined
          : AbortSignal.timeout(timeoutMs ?? this.#timeoutMs),
      });
    } catch (error) {
      throw new DeployAgentUnavailableError(error);
    }
  }

  /**
   * `timeoutMs` exists because the default is sized for a question, not for
   * work. Anything that waits on a health gate — a restart, an env apply — runs
   * to the agent's 90-second deadline, and aborting at 15 would report a failure
   * for an operation that went on to succeed.
   */
  async json<T>(
    path: string,
    init: RequestInit & { timeoutMs?: number } = {},
  ): Promise<{ status: number; body: T }> {
    const response = await this.#call(path, init);
    const body = (await response.json().catch(() => null)) as T;
    return { status: response.status, body };
  }

  async post(path: string, body?: unknown): Promise<Response> {
    return this.#call(path, {
      method: "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  async delete(path: string): Promise<Response> {
    return this.#call(path, { method: "DELETE" });
  }

  /**
   * Returns the upstream response with its body untouched. The caller returns
   * this object straight out of the handler — copying the body through a
   * `ReadableStream` of its own is what turns a tail into a buffer.
   */
  async stream(path: string, signal?: AbortSignal): Promise<Response> {
    const upstream = await this.#call(path, { method: "GET", stream: true });
    const headers = new Headers();
    for (const [name, value] of upstream.headers) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers.set(name, value);
    }
    // Without this a reverse proxy in front of the API happily buffers the
    // whole stream and delivers it when the build ends.
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("x-accel-buffering", "no");
    if (signal) {
      signal.addEventListener("abort", () => void upstream.body?.cancel(), {
        once: true,
      });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  }
}
