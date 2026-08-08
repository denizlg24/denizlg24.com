import { z } from "zod";

/**
 * Only the fields forge acts on. GitHub's payloads are enormous and grow, and
 * validating the whole of one would turn an added field into a dropped webhook.
 */
const repositorySchema = z.object({
  name: z.string(),
  owner: z.object({ login: z.string() }),
});

const installationRefSchema = z.object({ id: z.number().int() });

export const githubPushEventSchema = z.object({
  ref: z.string(),
  after: z.string(),
  deleted: z.boolean().optional(),
  repository: repositorySchema,
  installation: installationRefSchema.optional(),
  head_commit: z.object({ message: z.string() }).nullish(),
});
export type GithubPushEvent = z.infer<typeof githubPushEventSchema>;

export const githubPullRequestEventSchema = z.object({
  action: z.string(),
  number: z.number().int(),
  repository: repositorySchema,
  installation: installationRefSchema.optional(),
  pull_request: z.object({
    head: z.object({ ref: z.string(), sha: z.string() }),
    title: z.string().nullish(),
    draft: z.boolean().optional(),
  }),
});
export type GithubPullRequestEvent = z.infer<
  typeof githubPullRequestEventSchema
>;

const repositoryRefSchema = z.object({ full_name: z.string() });

export const githubInstallationEventSchema = z.object({
  action: z.string(),
  installation: z.object({
    id: z.number().int(),
    account: z.object({ login: z.string(), type: z.string() }).nullish(),
    repository_selection: z.string().nullish(),
    suspended_at: z.string().nullish(),
  }),
  /** Present on `installation`; the two deltas below come with the other event. */
  repositories: z.array(repositoryRefSchema).nullish(),
  repositories_added: z.array(repositoryRefSchema).nullish(),
  repositories_removed: z.array(repositoryRefSchema).nullish(),
});
export type GithubInstallationEvent = z.infer<
  typeof githubInstallationEventSchema
>;

export interface WebhookDeployIntent {
  kind: "production" | "preview";
  ref: string;
  sha: string;
  message: string | null;
  prNumber: number | null;
}
