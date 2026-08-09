import { toApiError, toTransportError } from "@repo/cloud-ui/api-error";
import {
  type CompleteSignupInput,
  type CompleteSignupResult,
  completeSignupResultSchema,
  type ForgeDeploymentSummary,
  type ForgeOverview,
  forgeDeploymentSummarySchema,
  forgeOverviewSchema,
  type MetricsResponse,
  metricsResponseSchema,
  type SafeUser,
  safeUserSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { API_BASE_URL } from "./env";

export {
  ApiError,
  errorMessage,
  isApiError,
  isUnreachable,
} from "@repo/cloud-ui/api-error";

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildUrl(path: string, query?: RequestOptions["query"]): URL {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

async function send(path: string, options: RequestOptions = {}) {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? "GET",
      credentials: "include",
      headers:
        options.body === undefined
          ? undefined
          : { "content-type": "application/json" },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal:
        options.signal ??
        AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw toTransportError(error);
  }
  if (!response.ok) throw await toApiError(response);
  return response;
}

const envelopeSchema = z.object({ data: z.unknown() });

async function data<T extends z.ZodType>(
  schema: T,
  path: string,
  options?: RequestOptions,
): Promise<z.output<T>> {
  const payload = envelopeSchema.parse(
    await (await send(path, options)).json(),
  );
  return schema.parse(payload.data);
}

async function streamSse(
  path: string,
  onLine: (line: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await send(path, { signal });
  if (!response.body) throw new Error("Log stream returned no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  const drain = (final: boolean) => {
    let boundary = pending.indexOf("\n\n");
    while (boundary >= 0 || (final && pending.length > 0)) {
      const end = boundary >= 0 ? boundary : pending.length;
      const event = pending.slice(0, end);
      pending = boundary >= 0 ? pending.slice(boundary + 2) : "";
      const lines = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""));
      if (lines.length > 0) onLine(lines.join("\n"));
      boundary = pending.indexOf("\n\n");
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      pending += decoder.decode();
      drain(true);
      break;
    }
    pending += decoder.decode(value, { stream: true });
    drain(false);
  }
}

export const api = {
  me: (): Promise<SafeUser> => data(safeUserSchema, "/api/me"),
  completeSignup: (input: CompleteSignupInput): Promise<CompleteSignupResult> =>
    data(completeSignupResultSchema, "/api/auth/complete-signup", {
      method: "POST",
      body: input,
    }),
  forge: {
    overview: (): Promise<ForgeOverview> =>
      data(forgeOverviewSchema, "/api/forge/overview"),
    deployments: (limit = 100): Promise<ForgeDeploymentSummary[]> =>
      data(z.array(forgeDeploymentSummarySchema), "/api/forge/deployments", {
        query: { limit },
      }),
    metrics: (query: {
      series: string[];
      from: string;
      to: string;
      step: number;
    }): Promise<MetricsResponse> =>
      data(metricsResponseSchema, "/api/forge/metrics", {
        query: { ...query, series: query.series.join(",") },
      }),
    restart: (deploymentId: string): Promise<unknown> =>
      data(
        z.unknown(),
        `/api/forge/deployments/${encodeURIComponent(deploymentId)}/restart`,
        {
          method: "POST",
          timeoutMs: 120_000,
        },
      ),
    streamLogs: async (
      containerId: string,
      onLine: (line: string) => void,
      signal: AbortSignal,
    ): Promise<void> =>
      streamSse(
        `/api/forge/containers/${encodeURIComponent(containerId)}/logs`,
        onLine,
        signal,
      ),
    streamBuildLogs: (
      deploymentId: string,
      onLine: (line: string) => void,
      signal: AbortSignal,
    ): Promise<void> =>
      streamSse(
        `/api/deploy/deployments/${encodeURIComponent(deploymentId)}/logs`,
        onLine,
        signal,
      ),
  },
};
