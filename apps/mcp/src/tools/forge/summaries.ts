import {
  deployBranchSchema,
  deploymentSchema,
  deployTargetListEntrySchema,
  forgeDeploymentPageSchema,
  forgeDeploymentSummarySchema,
  paginationSchema,
} from "@repo/schemas/cloud";
import { z } from "zod";
import { isRecord, mapResult, ok, type ToolResult } from "../define";

/**
 * The list tools return compact rows. A full deployment is ~1 KB before its
 * commit message, and bodies in this repo run to paragraphs: 18 targets
 * listed at 117 KB, well past what a tool result can carry. The get tools
 * keep every field.
 */

function firstLine(message: string): string {
  return (message.split("\n", 1)[0] ?? "").trimEnd();
}

const subject = z
  .string()
  .nullable()
  .transform((message) => (message === null ? null : firstLine(message)));

const deployment = deploymentSchema.shape;
const deploymentSummarySchema = z.object({
  id: deployment.id,
  kind: deployment.kind,
  environmentName: deployment.environmentName,
  status: deployment.status,
  phase: deployment.phase,
  gitRef: deployment.gitRef,
  gitSha: deployment.gitSha,
  gitMessage: subject,
  url: deployment.url,
  error: deployment.error,
  createdAt: deployment.createdAt,
  readyAt: deployment.readyAt,
});

const target = deployTargetListEntrySchema.shape;
const targetListSchema = z.object({
  data: z.array(
    z
      .object({
        id: target.id,
        projectSlug: target.projectSlug,
        name: target.name,
        repoOwner: target.repoOwner,
        repoName: target.repoName,
        rootDirectory: target.rootDirectory,
        productionBranch: target.productionBranch,
        framework: target.framework,
        autoDeploy: target.autoDeploy,
        pausedAt: target.pausedAt,
        primaryHostname: target.primaryHostname,
        latestDeployment: deploymentSummarySchema.nullable(),
        latestProduction: deploymentSummarySchema.nullable().default(null),
      })
      // Production is usually also the newest deployment; repeating it doubles
      // the row for nothing.
      .transform(({ latestProduction, ...row }) => ({
        ...row,
        latestProduction:
          latestProduction !== null &&
          latestProduction.id === row.latestDeployment?.id
            ? { id: latestProduction.id, sameAsLatestDeployment: true }
            : latestProduction,
      })),
  ),
});

const deploymentListSchema = z.object({
  data: z.array(deploymentSummarySchema),
  pagination: paginationSchema,
});

const branch = deployBranchSchema.shape;
const branchListSchema = z.object({
  data: z.array(
    z.object({
      gitRef: branch.gitRef,
      prNumber: branch.prNumber,
      deploymentCount: branch.deploymentCount,
      latest: deploymentSummarySchema,
    }),
  ),
});

const row = forgeDeploymentSummarySchema.shape;
const page = forgeDeploymentPageSchema.shape;
const searchPageSchema = z.object({
  data: z.object({
    deployments: z.array(
      z.object({
        id: row.id,
        targetName: row.targetName,
        projectSlug: row.projectSlug,
        kind: row.kind,
        status: row.status,
        phase: row.phase,
        gitRef: row.gitRef,
        gitSha: row.gitSha,
        gitMessage: subject,
        hostname: row.hostname,
        error: row.error,
        createdAt: row.createdAt,
        readyAt: row.readyAt,
      }),
    ),
    total: page.total,
    projects: page.projects,
    branches: page.branches,
    repos: page.repos,
  }),
});

function commitSubjects(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(commitSubjects);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] =
      key === "gitMessage" && typeof entry === "string"
        ? firstLine(entry)
        : commitSubjects(entry);
  }
  return out;
}

/**
 * A payload that no longer matches the schema still has its commit messages
 * cut, so drift degrades to a larger result instead of a failed call.
 */
function summarize(label: string, schema: z.ZodType) {
  return (result: ToolResult): ToolResult => {
    if (result.isError || !result.structuredContent) return result;
    const { httpStatus, ...body } = result.structuredContent;
    const parsed = schema.safeParse(body);
    if (parsed.success) return ok(parsed.data, { httpStatus });
    console.warn(
      `${label}: upstream shape drifted from @repo/schemas, returning it unsummarized`,
      parsed.error.issues.slice(0, 3),
    );
    return mapResult(result, commitSubjects);
  };
}

export const summarizeTargets = summarize(
  "forge_targets_list",
  targetListSchema,
);
export const summarizeDeployments = summarize(
  "forge_deployments_list",
  deploymentListSchema,
);
export const summarizeBranches = summarize(
  "forge_target_branches",
  branchListSchema,
);
export const summarizeSearch = summarize(
  "forge_deployments_search",
  searchPageSchema,
);
