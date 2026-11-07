import { describe, expect, test } from "bun:test";
import type { AuthVariables } from "@repo/cloud-core";
import { GithubApiError } from "@repo/cloud-core/deploy";
import type { ActivityEntryInput } from "@repo/cloud-core/ops";
import type { SafeUserRecord } from "@repo/cloud-core/services";
import { Hono } from "hono";
import {
  RUN_TOKEN_PERMISSIONS,
  type RunTokenInstallation,
  runTokenRoutes,
} from "./run-token";

function userWithRole(role: SafeUserRecord["role"]): SafeUserRecord {
  return {
    id: "6a2150ee-03ea-4b5a-a67b-102788069cb4",
    username: "deniz",
    email: null,
    role,
    status: "active",
    totpEnabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

interface Principal {
  role?: "superuser" | "user";
  sessionId?: string;
  machineClientId?: string;
}

const installations: RunTokenInstallation[] = [
  {
    installationId: 11,
    accountLogin: "denizlg24",
    repositorySelection: "selected",
    suspendedAt: null,
    repositories: [{ owner: "denizlg24", name: "Sprint-E2E" }],
  },
  {
    installationId: 12,
    accountLogin: "suspended-org",
    repositorySelection: "all",
    suspendedAt: new Date(),
    repositories: [],
  },
];

function harness(principal: Principal, allowed: string[] = ["runner"]) {
  const mints: {
    installationId: number;
    repositories: readonly string[];
    permissions: Readonly<Record<string, string>>;
  }[] = [];
  const audits: ActivityEntryInput[] = [];
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", async (context, next) => {
    if (principal.sessionId) {
      context.set("user", userWithRole(principal.role ?? "superuser"));
      context.set("sessionId", principal.sessionId);
      context.set("machineClientId", principal.machineClientId);
    }
    await next();
  });
  app.route(
    "/run-token",
    runTokenRoutes({
      listInstallations: async () => installations,
      github: {
        client: {
          createInstallationToken: async (input) => {
            mints.push(input);
            if (input.repositories[0] === "boom") {
              throw new GithubApiError("Unprocessable", 422);
            }
            return {
              token: "ghs_x",
              expiresAt: "2026-11-03T20:00:00Z",
              permissions: { ...input.permissions },
            };
          },
        },
      },
      allowedClientIds: new Set(allowed),
      audit: (entry) => audits.push(entry),
    }),
  );
  const call = (body: unknown) =>
    app.request("/run-token", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });
  return { call, mints, audits };
}

describe("POST /github/run-token", () => {
  test("the runner's client mints a token for one repository", async () => {
    const { call, mints, audits } = harness({
      sessionId: "oauth:jti",
      machineClientId: "runner",
    });
    const response = await call({
      repo: "denizlg24/sprint-e2e",
      kind: "implement",
    });
    expect(response.status).toBe(200);
    expect(mints).toEqual([
      {
        installationId: 11,
        repositories: ["Sprint-E2E"],
        permissions: RUN_TOKEN_PERMISSIONS.implement,
      },
    ]);
    expect(audits[0]).toMatchObject({
      action: "deploy.run_token_minted",
      actorLabel: "client:runner",
      targetId: "denizlg24/sprint-e2e",
    });
  });

  test("another machine client is refused before anything is minted", async () => {
    const { call, mints } = harness({
      sessionId: "oauth:jti",
      machineClientId: "mcp",
    });
    const response = await call({
      repo: "denizlg24/sprint-e2e",
      kind: "review",
    });
    expect(response.status).toBe(403);
    expect(mints).toHaveLength(0);
  });

  test("the owner's own session may mint", async () => {
    const { call } = harness({ sessionId: "cookie-session" });
    const response = await call({
      repo: "denizlg24/sprint-e2e",
      kind: "review",
    });
    expect(response.status).toBe(200);
  });

  test("no session, or a non-superuser, is refused", async () => {
    expect(
      (await harness({}).call({ repo: "a/b", kind: "review" })).status,
    ).toBe(403);
    expect(
      (
        await harness({ sessionId: "s", role: "user" }).call({
          repo: "denizlg24/sprint-e2e",
          kind: "review",
        })
      ).status,
    ).toBe(403);
  });

  test("a repository no live installation can see is refused", async () => {
    const { call, mints } = harness({ sessionId: "cookie-session" });
    expect(
      (await call({ repo: "someone/else", kind: "implement" })).status,
    ).toBe(404);
    expect(
      (await call({ repo: "suspended-org/anything", kind: "implement" }))
        .status,
    ).toBe(404);
    expect(mints).toHaveLength(0);
  });

  test("a review token cannot write contents", async () => {
    const { call, mints } = harness({ sessionId: "cookie-session" });
    await call({ repo: "denizlg24/sprint-e2e", kind: "review" });
    expect(mints[0]?.permissions.contents).toBe("read");
    expect(RUN_TOKEN_PERMISSIONS.review.contents).toBe("read");
    for (const kind of [
      "implement",
      "fix-review",
      "release",
      "custom",
    ] as const) {
      expect(RUN_TOKEN_PERMISSIONS[kind].contents).toBe("write");
    }
  });

  test("an invalid body is a 400", async () => {
    const { call } = harness({ sessionId: "cookie-session" });
    expect((await call({ repo: "nope", kind: "implement" })).status).toBe(400);
    expect(
      (await call({ repo: "denizlg24/sprint-e2e", kind: "deploy" })).status,
    ).toBe(400);
  });
});
