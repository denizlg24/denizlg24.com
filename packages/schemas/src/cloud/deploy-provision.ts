import { z } from "zod";

import { createDeployTargetInputSchema } from "./deploy";
import { deployEnvVarInputSchema } from "./deploy-env";
import { createProjectInputSchema } from "./projects";

/**
 * Lives apart from `deploy.ts` only because it needs both the target schema
 * and the env-var schema, and `deploy-env.ts` already imports `deploy.ts`.
 * Importing back the other way would be a cycle Zod cannot survive: both
 * modules build their schemas at evaluation time, so whichever loses the race
 * sees `undefined` where a schema should be.
 */
export const createDeployTargetRequestSchema = createDeployTargetInputSchema
  .omit({ projectId: true })
  .extend({
    projectId: z.uuid().optional(),
    /**
     * The other half of the exclusive choice below: creating the cloud project
     * in the same call is what lets the UI go from "picked a repository" to a
     * deploying target without a detour through /projects/new.
     */
    project: createProjectInputSchema.optional(),
    /**
     * Applied inside the same transaction that seeds the binding rows, so a
     * pasted `.env` cannot land as a follow-up `PUT .../env` — that call is a
     * full replace and would delete the seeds it never saw.
     */
    env: z.array(deployEnvVarInputSchema).max(500).optional(),
  })
  .refine(
    (input) =>
      (input.projectId === undefined) !== (input.project === undefined),
    { message: "Provide exactly one of projectId or project" },
  );
export type CreateDeployTargetRequest = z.infer<
  typeof createDeployTargetRequestSchema
>;

export const githubInstallationSummarySchema = z.object({
  installationId: z.number().int(),
  accountLogin: z.string(),
  accountType: z.string().nullable(),
  repositorySelection: z.string().nullable(),
});
export type GithubInstallationSummary = z.infer<
  typeof githubInstallationSummarySchema
>;

export const githubRepositorySchema = z.object({
  id: z.number().int(),
  installationId: z.number().int(),
  owner: z.string(),
  name: z.string(),
  fullName: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
  pushedAt: z.string().nullable(),
});
export type GithubRepositorySummary = z.infer<typeof githubRepositorySchema>;

export const githubBranchSchema = z.object({
  name: z.string(),
  sha: z.string(),
});

export const githubTreeEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  type: z.enum(["file", "dir"]),
});

export const githubConnectionSchema = z.object({
  /** Absent when GITHUB_APP_SLUG is unset; the UI hides the connect button. */
  installUrl: z.string().nullable(),
  installations: z.array(githubInstallationSummarySchema),
});
export type GithubConnection = z.infer<typeof githubConnectionSchema>;
