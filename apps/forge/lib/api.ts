import { toApiError, toTransportError } from "@repo/cloud-ui/api-error";
import { deployApi } from "@repo/cloud-ui/deploy/api";
import { projectsApi } from "@repo/cloud-ui/projects/api";
import {
  type CompleteSignupInput,
  type CompleteSignupResult,
  completeSignupResultSchema,
  type ForgeDeploymentPage,
  type ForgeDeploymentQuery,
  type ForgeDeploymentSummary,
  type ForgeOverview,
  type ForgePreviewShare,
  type ForgeProjectMetricName,
  type ForgeProjectMetricsResponse,
  type ForgeRequestLogPage,
  type ForgeRequestLogQuery,
  type ForgeRequestLogs,
  type ForgeRequestLogsQuery,
  forgeDeploymentPageSchema,
  forgeDeploymentSummarySchema,
  forgeOverviewSchema,
  forgePreviewShareSchema,
  forgeProjectMetricsResponseSchema,
  forgeRequestLogPageSchema,
  forgeRequestLogsSchema,
  type MetricCatalogEntry,
  type MetricsResponse,
  metricCatalogResponseSchema,
  metricsResponseSchema,
  type SafeUser,
  type ShareExpiresIn,
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
  query?: Record<string, string | number | undefined | null | string[]>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function buildUrl(path: string, query?: RequestOptions["query"]): URL {
  const url = new URL(path, API_BASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    // Repeated rather than comma-joined so a value containing a comma cannot
    // silently split into two filters.
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(key, entry);
      continue;
    }
    url.searchParams.set(key, String(value));
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
  /**
   * Shared with apps/cloud, which drives the same targets over the same routes.
   * Its request core is the one this namespace was written against, so it
   * carries its own timeouts rather than the shorter default above.
   */
  deploy: deployApi,

  /**
   * The namespace half of a project — API keys, collections, vector indexes.
   * Shared for the same reason `deploy` is: these routes need PATCH and
   * DELETE, which the request core above deliberately does not carry.
   */
  projects: projectsApi,

  me: (): Promise<SafeUser> => data(safeUserSchema, "/api/me"),
  completeSignup: (input: CompleteSignupInput): Promise<CompleteSignupResult> =>
    data(completeSignupResultSchema, "/api/auth/complete-signup", {
      method: "POST",
      body: input,
    }),
  forge: {
    overview: (): Promise<ForgeOverview> =>
      data(forgeOverviewSchema, "/api/forge/overview"),
    /**
     * The host series that exist, with their last value. Read from the samples
     * table rather than declared, because what a machine publishes depends on
     * its hardware — the chart pickers are built from this.
     */
    series: (): Promise<MetricCatalogEntry[]> =>
      data(metricCatalogResponseSchema, "/api/forge/series").then(
        (page) => page.series,
      ),
    deployments: (
      query: Partial<ForgeDeploymentQuery> = {},
    ): Promise<ForgeDeploymentPage> =>
      data(forgeDeploymentPageSchema, "/api/forge/deployments", {
        query: {
          limit: query.limit,
          offset: query.offset,
          sort: query.sort,
          direction: query.direction,
          status: query.status,
          project: query.project,
          search: query.search,
          kind: query.kind,
          branch: query.branch,
          repo: query.repo,
          since: query.since,
          until: query.until,
        },
      }),
    deployment: (deploymentId: string): Promise<ForgeDeploymentSummary> =>
      data(
        forgeDeploymentSummarySchema,
        `/api/forge/deployments/${encodeURIComponent(deploymentId)}`,
      ),
    createPreviewShare: (
      deploymentId: string,
      expiresIn: ShareExpiresIn,
    ): Promise<ForgePreviewShare> =>
      data(
        forgePreviewShareSchema,
        `/api/forge/deployments/${encodeURIComponent(deploymentId)}/share`,
        { method: "POST", body: { expiresIn } },
      ),
    metrics: (query: {
      series: string[];
      from: string;
      to: string;
      step: number;
    }): Promise<MetricsResponse> =>
      data(metricsResponseSchema, "/api/forge/metrics", {
        query: { ...query, series: query.series.join(",") },
      }),
    /**
     * A project's own history, aggregated across every deployment it had in the
     * window — container samples are keyed per deployment, so charting one key
     * would make a project's graph restart at its last deploy.
     *
     * Aggregating is also why this cannot be parsed as a metrics response: the
     * series that comes back is keyed by the bare metric, not by the
     * `forge-container:<id>:<metric>` key the samples were stored under.
     */
    projectMetrics: (
      projectSlug: string,
      query: {
        metrics: ForgeProjectMetricName[];
        from: string;
        to: string;
        step: number;
        kind?: "production" | "preview";
        /**
         * One container instead of the average of every container behind the
         * project. Without it a project running two previews reports the mean
         * of three containers as though it were one.
         */
        deployment?: string;
      },
    ): Promise<ForgeProjectMetricsResponse> =>
      data(
        forgeProjectMetricsResponseSchema,
        `/api/forge/projects/${encodeURIComponent(projectSlug)}/metrics`,
        { query: { ...query, metrics: query.metrics.join(",") } },
      ),
    requests: (
      deploymentId: string,
      query: Partial<ForgeRequestLogQuery> = {},
    ): Promise<ForgeRequestLogPage> =>
      data(
        forgeRequestLogPageSchema,
        `/api/forge/deployments/${encodeURIComponent(deploymentId)}/requests`,
        {
          query: {
            limit: query.limit,
            method: query.method,
            status: query.status,
            search: query.search,
            minDurationMs: query.minDurationMs,
          },
        },
      ),
    /**
     * The container output for one request. `requestId` gives an exact join
     * when the app logs the header Caddy stamps; without it the window is the
     * best available answer, and the response says which one came back.
     */
    requestLogs: (
      deploymentId: string,
      query: ForgeRequestLogsQuery,
    ): Promise<ForgeRequestLogs> =>
      data(
        forgeRequestLogsSchema,
        `/api/forge/deployments/${encodeURIComponent(deploymentId)}/request-logs`,
        {
          query: {
            from: query.from,
            to: query.to,
            requestId: query.requestId,
            limit: query.limit,
          },
        },
      ),
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
