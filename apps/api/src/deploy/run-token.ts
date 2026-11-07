import type { AuthVariables } from "@repo/cloud-core";
import { GithubApiError, type GithubAppClient } from "@repo/cloud-core/deploy";
import type { ActivityEntryInput } from "@repo/cloud-core/ops";
import { runTokenRequestSchema, type SprintSlotKind } from "@repo/schemas";
import { Hono } from "hono";

type Permission = "read" | "write";

/**
 * What a sprint run's token may do, by slot kind. A reviewer cannot push: it
 * only reads the code and posts a review. `statuses` and `checks` are what the
 * runner reads to wait on CI before it offers a release.
 */
export const RUN_TOKEN_PERMISSIONS: Record<
  SprintSlotKind,
  Readonly<Record<string, Permission>>
> = {
  implement: {
    contents: "write",
    pull_requests: "write",
    checks: "read",
    statuses: "read",
    actions: "read",
  },
  "fix-review": {
    contents: "write",
    pull_requests: "write",
    checks: "read",
    statuses: "read",
    actions: "read",
  },
  release: {
    contents: "write",
    pull_requests: "write",
    checks: "read",
    statuses: "read",
    actions: "read",
  },
  custom: {
    contents: "write",
    pull_requests: "write",
    checks: "read",
    statuses: "read",
    actions: "read",
  },
  review: {
    contents: "read",
    pull_requests: "write",
    checks: "read",
    statuses: "read",
  },
};

export interface RunTokenInstallation {
  installationId: number;
  accountLogin: string;
  repositorySelection: string;
  suspendedAt: Date | null;
  repositories: { owner: string; name: string }[];
}

export interface RunTokenRouteOptions {
  listInstallations(): Promise<RunTokenInstallation[]>;
  github: {
    client: Pick<GithubAppClient, "createInstallationToken">;
  } | null;
  /** OAuth client ids whose machine tokens may mint. Everyone else's are refused. */
  allowedClientIds: ReadonlySet<string>;
  audit?: (entry: ActivityEntryInput) => void;
}

/**
 * The installation that can see the repository, from what the webhooks
 * recorded. An `all repositories` installation lists nothing created after it
 * was granted, so the account login is the fallback.
 */
function installationForRepo(
  rows: readonly RunTokenInstallation[],
  owner: string,
  name: string,
): { installationId: number; repoName: string } | null {
  const live = rows.filter((row) => row.suspendedAt === null);
  for (const row of live) {
    const repository = row.repositories.find(
      (candidate) =>
        candidate.owner.toLowerCase() === owner.toLowerCase() &&
        candidate.name.toLowerCase() === name.toLowerCase(),
    );
    if (repository) {
      return { installationId: row.installationId, repoName: repository.name };
    }
  }
  const byOwner = live.find(
    (row) =>
      row.repositorySelection === "all" &&
      row.accountLogin.toLowerCase() === owner.toLowerCase(),
  );
  return byOwner
    ? { installationId: byOwner.installationId, repoName: name }
    : null;
}

function refuse(code: string, message: string) {
  return { error: { code, message } } as const;
}

/**
 * `POST /api/deploy/github/run-token` — a one-hour installation token scoped
 * to one repository and the slot kind's permissions, for the agent runner.
 * The App's private key never leaves this process.
 */
export function runTokenRoutes(options: RunTokenRouteOptions) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.post("/", async (context) => {
    const user = context.get("user");
    const sessionId = context.get("sessionId");
    if (!user || !sessionId) {
      return context.json(
        refuse("SESSION_REQUIRED", "A session or OAuth token is required"),
        403,
      );
    }
    if (user.role !== "superuser") {
      return context.json(refuse("FORBIDDEN", "Superuser only"), 403);
    }
    const machineClientId = context.get("machineClientId");
    if (machineClientId && !options.allowedClientIds.has(machineClientId)) {
      return context.json(
        refuse("CLIENT_NOT_ALLOWED", "This client may not mint run tokens"),
        403,
      );
    }
    if (!options.github) {
      return context.json(
        refuse("GITHUB_APP_DISABLED", "GitHub App is not configured"),
        503,
      );
    }

    const parsed = runTokenRequestSchema.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success) {
      return context.json(
        refuse(
          "VALIDATION_ERROR",
          parsed.error.issues[0]?.message ?? "Invalid body",
        ),
        400,
      );
    }
    const { repo, kind } = parsed.data;
    const [owner = "", name = ""] = repo.split("/");
    const installation = installationForRepo(
      await options.listInstallations(),
      owner,
      name,
    );
    if (!installation) {
      return context.json(
        refuse(
          "INSTALLATION_NOT_FOUND",
          `No GitHub installation can see ${repo}`,
        ),
        404,
      );
    }

    const permissions = RUN_TOKEN_PERMISSIONS[kind];
    try {
      const minted = await options.github.client.createInstallationToken({
        installationId: installation.installationId,
        repositories: [installation.repoName],
        permissions,
      });
      options.audit?.({
        category: "system",
        action: "deploy.run_token_minted",
        actorType: "user",
        actorId: user.id,
        actorLabel: machineClientId
          ? `client:${machineClientId}`
          : user.username,
        targetType: "github_repository",
        targetId: repo,
        message: `Run token for ${repo} (${kind})`,
        metadata: { repo, kind, permissions: { ...permissions } },
      });
      return context.json({
        data: {
          token: minted.token,
          expiresAt: minted.expiresAt,
          permissions: minted.permissions,
        },
      });
    } catch (error) {
      if (error instanceof GithubApiError) {
        return context.json(
          refuse("GITHUB_ERROR", error.message),
          error.status === 422 || error.status === 404 ? 422 : 502,
        );
      }
      throw error;
    }
  });

  return app;
}
