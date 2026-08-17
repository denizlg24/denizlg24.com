import { getPiCronConnection } from "@/lib/capabilities/picron";
import { connectDB } from "@/lib/mongodb";
import {
  type PiCronHistoryEntry,
  type PiCronJob,
  type PiCronJobInput,
  type PiCronStats,
  piCronFetch,
} from "@/lib/picron";
import { Resource } from "@/models/Resource";
import type { ToolDefinition } from "./types";

/**
 * PiCron — the scheduler running on a resource, reached through a capability
 * on that resource rather than directly. Every tool therefore needs both the
 * resource id and the capability id; list_resource_capabilities returns them.
 *
 * These jobs are what actually drive the markets engine and the agent-task
 * cron, neither of which this repo schedules itself. Disabling one silently
 * stops that work.
 */

const MAX_HISTORY = 25;

async function connect(input: Record<string, unknown>) {
  const resourceId = String(input.resourceId ?? "");
  const capabilityId = String(input.capabilityId ?? "");
  if (!resourceId || !capabilityId) {
    throw new Error("resourceId and capabilityId are required");
  }
  return getPiCronConnection(resourceId, capabilityId);
}

function call<T>(
  conn: Awaited<ReturnType<typeof getPiCronConnection>>,
  path: string,
  init?: RequestInit,
) {
  return piCronFetch<T>(
    conn.cacheKey,
    conn.baseUrl,
    conn.username,
    conn.password,
    path,
    init,
  );
}

export const picronTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_resource_capabilities",
      description:
        "Capabilities attached to a resource — the external services it exposes, such as a PiCron scheduler. Returns the capability ids the picron tools need. Credentials are never included.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
        },
        required: ["resourceId"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) => {
      await connectDB();
      const resource = await Resource.findById(String(input.resourceId ?? ""));
      if (!resource) throw new Error("Resource not found");
      return {
        resource: resource.name,
        capabilities: resource.capabilities.map((cap) => ({
          id: cap._id.toString(),
          type: cap.type,
          label: cap.label,
          baseUrl: cap.baseUrl,
          isActive: cap.isActive,
        })),
      };
    },
  },
  {
    schema: {
      name: "list_picron_jobs",
      description:
        "Scheduled jobs on a PiCron instance, with their cron expression, last status and next run.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
        },
        required: ["resourceId", "capabilityId"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) => {
      const jobs = await call<PiCronJob[]>(await connect(input), "/api/jobs");
      // The body of a job is an arbitrary request payload and can be large;
      // it is available through get_picron_job when actually needed.
      return {
        jobs: jobs.map((job) => ({
          id: job.id,
          name: job.name,
          expression: job.expression,
          url: job.url,
          method: job.method,
          enabled: job.enabled,
          lastStatus: job.last_status,
          lastRun: job.last_run,
          lastError: job.last_error,
          nextRun: job.next_run,
        })),
      };
    },
  },
  {
    schema: {
      name: "get_picron_job",
      description: "One PiCron job in full, including its headers and body.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
          jobId: { type: "string", description: "Job ID." },
        },
        required: ["resourceId", "capabilityId", "jobId"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) =>
      call<PiCronJob>(
        await connect(input),
        `/api/jobs/${encodeURIComponent(String(input.jobId ?? ""))}`,
      ),
  },
  {
    schema: {
      name: "create_picron_job",
      description:
        "Schedule a new PiCron job. The job calls a URL on the given cron expression.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
          name: { type: "string", description: "Job name." },
          expression: {
            type: "string",
            description: "Cron expression, e.g. '0 3 * * *'.",
          },
          url: { type: "string", description: "URL to call." },
          method: { type: "string", description: "HTTP method, default GET." },
          headers: {
            type: "object",
            description: "Request headers as a flat string map.",
          },
          body: { type: "string", description: "Request body." },
          timeout: {
            type: "number",
            description: "Request timeout in seconds.",
            minimum: 1,
          },
          enabled: {
            type: "boolean",
            description: "Whether it runs, default true.",
          },
        },
        required: ["resourceId", "capabilityId", "name", "expression", "url"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const job: PiCronJobInput = {
        name: String(input.name ?? ""),
        expression: String(input.expression ?? ""),
        url: String(input.url ?? ""),
        method: input.method === undefined ? undefined : String(input.method),
        headers: input.headers as Record<string, string> | undefined,
        body: input.body === undefined ? undefined : String(input.body),
        timeout: input.timeout as number | undefined,
        enabled: input.enabled as boolean | undefined,
      };
      return call<PiCronJob>(await connect(input), "/api/jobs", {
        method: "POST",
        body: JSON.stringify(job),
      });
    },
  },
  {
    schema: {
      name: "update_picron_job",
      description:
        "Change a PiCron job. Setting enabled to false stops it running without deleting it — check what depends on the job first, since nothing else reports a schedule that silently stopped.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
          jobId: { type: "string", description: "Job ID." },
          name: { type: "string", description: "New name." },
          expression: { type: "string", description: "New cron expression." },
          url: { type: "string", description: "New URL." },
          method: { type: "string", description: "New HTTP method." },
          headers: { type: "object", description: "New headers." },
          body: { type: "string", description: "New body." },
          timeout: {
            type: "number",
            description: "New timeout in seconds.",
            minimum: 1,
          },
          enabled: { type: "boolean", description: "Enable or disable it." },
        },
        required: ["resourceId", "capabilityId", "jobId"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      const { resourceId, capabilityId, jobId, ...patch } = input;
      if (Object.keys(patch).length === 0) {
        throw new Error("Nothing to update");
      }
      return call<PiCronJob>(
        await connect({ resourceId, capabilityId }),
        `/api/jobs/${encodeURIComponent(String(jobId ?? ""))}`,
        { method: "PUT", body: JSON.stringify(patch) },
      );
    },
  },
  {
    schema: {
      name: "delete_picron_job",
      description:
        "Delete a PiCron job. Prefer disabling it with update_picron_job unless removal is intended.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
          jobId: { type: "string", description: "Job ID." },
        },
        required: ["resourceId", "capabilityId", "jobId"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) => {
      await call<unknown>(
        await connect(input),
        `/api/jobs/${encodeURIComponent(String(input.jobId ?? ""))}`,
        { method: "DELETE" },
      );
      return { success: true };
    },
  },
  {
    schema: {
      name: "trigger_picron_job",
      description:
        "Run a PiCron job now, outside its schedule. The job's next scheduled run is unaffected.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
          jobId: { type: "string", description: "Job ID." },
        },
        required: ["resourceId", "capabilityId", "jobId"],
      },
    },
    isWrite: true,
    category: "resources",
    execute: async (input) =>
      call<unknown>(
        await connect(input),
        `/api/jobs/${encodeURIComponent(String(input.jobId ?? ""))}/trigger`,
        { method: "POST" },
      ),
  },
  {
    schema: {
      name: "get_picron_job_history",
      description:
        "Recent executions of a PiCron job with their status, duration and any error. Use it to find out why a schedule is not having the effect it should.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
          jobId: { type: "string", description: "Job ID." },
          limit: {
            type: "number",
            description: "Max entries, 1-25 (default 10).",
            minimum: 1,
            maximum: 25,
          },
        },
        required: ["resourceId", "capabilityId", "jobId"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) => {
      const history = await call<PiCronHistoryEntry[]>(
        await connect(input),
        `/api/jobs/${encodeURIComponent(String(input.jobId ?? ""))}/history`,
      );
      const limit = Math.min(
        Math.max(Number(input.limit ?? 10), 1),
        MAX_HISTORY,
      );
      return {
        entries: history.slice(0, limit).map((entry) => ({
          status: entry.status,
          durationMs: entry.duration_ms,
          error: entry.error,
          startedAt: entry.started_at,
          // The response body can be an entire page; the status and error are
          // what a diagnosis turns on.
          responsePreview: entry.response?.slice(0, 300),
        })),
        total: history.length,
      };
    },
  },
  {
    schema: {
      name: "get_picron_stats",
      description:
        "Job counts and 24-hour failure count for a PiCron instance.",
      input_schema: {
        type: "object",
        properties: {
          resourceId: { type: "string", description: "Resource ID." },
          capabilityId: {
            type: "string",
            description: "PiCron capability ID.",
          },
        },
        required: ["resourceId", "capabilityId"],
      },
    },
    isWrite: false,
    category: "resources",
    execute: async (input) =>
      call<PiCronStats>(await connect(input), "/api/stats"),
  },
];
