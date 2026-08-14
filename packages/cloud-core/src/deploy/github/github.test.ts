import { describe, expect, it } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";

import type {
  GithubPullRequestEvent,
  GithubPushEvent,
} from "@repo/schemas/cloud";
import { GithubAppClient } from "./client";
import {
  branchFromRef,
  canRunDeployCommand,
  comparisonBase,
  parseDeployCommand,
  planBranchTeardown,
  planPullRequestAttach,
  planPushDeployment,
  type WebhookTarget,
} from "./events";
import {
  createAppJwt,
  readGithubPrivateKey,
  verifyGithubSignature,
} from "./jwt";

const target: WebhookTarget = {
  productionBranch: "main",
  autoDeploy: true,
  previewDeploys: true,
};

function push(overrides: Partial<GithubPushEvent> = {}): GithubPushEvent {
  return {
    ref: "refs/heads/main",
    before: "0".repeat(40),
    after: "a".repeat(40),
    repository: { name: "site", owner: { login: "denizlg24" } },
    head_commit: { message: "ship it" },
    ...overrides,
  };
}

function pullRequest(
  overrides: Partial<GithubPullRequestEvent> = {},
): GithubPullRequestEvent {
  return {
    action: "synchronize",
    number: 7,
    repository: { name: "site", owner: { login: "denizlg24" } },
    pull_request: {
      base: { sha: "a".repeat(40) },
      head: { ref: "feature", sha: "b".repeat(40) },
      title: "Add a thing",
    },
    ...overrides,
  };
}

describe("planPushDeployment", () => {
  it("builds production off the production branch", () => {
    expect(planPushDeployment(push(), target)).toEqual({
      kind: "production",
      ref: "main",
      baseSha: null,
      sha: "a".repeat(40),
      message: "ship it",
      prNumber: null,
    });
  });

  it("builds a preview off any other branch", () => {
    const intent = planPushDeployment(
      push({ ref: "refs/heads/feature/thing" }),
      target,
    );
    expect(intent?.kind).toBe("preview");
    expect(intent?.ref).toBe("feature/thing");
  });

  it("carries the previous commit as the change-detection base", () => {
    const before = "c".repeat(40);
    expect(planPushDeployment(push({ before }), target)?.baseSha).toBe(before);
  });

  it("builds without filtering when history was force-pushed", () => {
    expect(
      planPushDeployment(push({ before: "c".repeat(40), forced: true }), target)
        ?.baseSha,
    ).toBeNull();
  });

  it("ignores tags and branch deletions", () => {
    // Both arrive as pushes and neither is a deployment; a deletion in
    // particular would otherwise build the commit that was just removed.
    expect(
      planPushDeployment(push({ ref: "refs/tags/v1" }), target),
    ).toBeNull();
    expect(planPushDeployment(push({ deleted: true }), target)).toBeNull();
  });

  it("honours the target's two toggles", () => {
    expect(
      planPushDeployment(push(), { ...target, autoDeploy: false }),
    ).toBeNull();
    // Previews off, production still deploys.
    const off = { ...target, previewDeploys: false };
    expect(
      planPushDeployment(push({ ref: "refs/heads/feature" }), off),
    ).toBeNull();
    expect(planPushDeployment(push(), off)?.kind).toBe("production");
  });
});

describe("comparisonBase", () => {
  it("keeps the base a push named", () => {
    const before = "c".repeat(40);
    expect(comparisonBase({ kind: "preview", baseSha: before }, target)).toBe(
      before,
    );
  });

  it("compares a baseless preview against the production branch", () => {
    // The first push of a branch. Reading a zero `before` as "no base" and
    // building unconditionally rebuilt every target in the repository, and
    // then the pull request event — which does have a base — reported those
    // same targets as skipped while their containers were building.
    const intent = planPushDeployment(
      push({ ref: "refs/heads/feature", created: true }),
      target,
    );
    expect(intent?.baseSha).toBeNull();
    expect(comparisonBase({ kind: "preview", baseSha: null }, target)).toBe(
      "main",
    );
  });

  it("leaves a baseless production build with nothing to compare", () => {
    // Production against the production branch is a comparison with itself,
    // which reports no changes and would skip the deployment entirely.
    expect(
      comparisonBase({ kind: "production", baseSha: null }, target),
    ).toBeNull();
  });

  it("does not invent a base from an unset production branch", () => {
    expect(
      comparisonBase(
        { kind: "preview", baseSha: null },
        { ...target, productionBranch: "" },
      ),
    ).toBeNull();
  });
});

describe("planBranchTeardown", () => {
  it("names the branch a deleting push removed", () => {
    expect(
      planBranchTeardown(push({ ref: "refs/heads/feature", deleted: true })),
    ).toBe("feature");
  });

  it("ignores an ordinary push", () => {
    // The same event shape carries both, and reading a live push as a teardown
    // would reap the preview the push just built.
    expect(planBranchTeardown(push({ ref: "refs/heads/feature" }))).toBeNull();
  });

  it("ignores a deleted tag", () => {
    // Tags never produce a preview, so there is no branch to name.
    expect(
      planBranchTeardown(push({ ref: "refs/tags/v1", deleted: true })),
    ).toBeNull();
  });
});

describe("planPullRequestAttach", () => {
  it("names the commit to report on and the number a push cannot know", () => {
    expect(planPullRequestAttach(pullRequest())).toEqual({
      ref: "feature",
      sha: "b".repeat(40),
      prNumber: 7,
    });
  });

  it("ignores actions that do not move the head commit", () => {
    for (const action of ["closed", "labeled", "edited", "assigned"]) {
      expect(planPullRequestAttach(pullRequest({ action }))).toBe(null);
    }
  });

  it("reports on a draft, because the push built it anyway", () => {
    const draft = {
      base: { sha: "a" },
      head: { ref: "f", sha: "c" },
      title: null,
      draft: true,
    };
    expect(
      planPullRequestAttach(pullRequest({ pull_request: draft }))?.ref,
    ).toBe("f");
  });
});

describe("GithubAppClient.compareFiles", () => {
  it("returns both sides of a rename and reports a complete comparison", async () => {
    let requested = "";
    const client = new GithubAppClient({
      config: {
        appId: "1",
        privateKey: "unused with a cached token",
        webhookSecret: "secret",
        slug: null,
      },
      cache: {
        get: async () => "installation-token",
        set: async () => {},
        delete: async () => {},
      },
      fetchImplementation: Object.assign(
        async (input: string | URL | Request) => {
          requested = String(input);
          return new Response(
            JSON.stringify({
              files: [
                {
                  filename: "apps/web/new.ts",
                  previous_filename: "apps/web/old.ts",
                },
                { filename: "packages/ui/button.tsx" },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          );
        },
        { preconnect: () => {} },
      ),
    });

    await expect(
      client.compareFiles({
        installationId: 1,
        owner: "denizlg24",
        repo: "site",
        base: "a".repeat(40),
        head: "b".repeat(40),
      }),
    ).resolves.toEqual({
      paths: ["apps/web/new.ts", "apps/web/old.ts", "packages/ui/button.tsx"],
      complete: true,
    });
    expect(requested).toContain(
      `/compare/${"a".repeat(40)}...${"b".repeat(40)}`,
    );
  });

  it("marks GitHub's 300-file ceiling as incomplete", async () => {
    const client = new GithubAppClient({
      config: {
        appId: "1",
        privateKey: "unused with a cached token",
        webhookSecret: "secret",
        slug: null,
      },
      cache: {
        get: async () => "installation-token",
        set: async () => {},
        delete: async () => {},
      },
      fetchImplementation: Object.assign(
        async () =>
          new Response(
            JSON.stringify({
              files: Array.from({ length: 300 }, (_, index) => ({
                filename: `file-${index}`,
              })),
            }),
            { headers: { "content-type": "application/json" } },
          ),
        { preconnect: () => {} },
      ),
    });

    expect(
      (
        await client.compareFiles({
          installationId: 1,
          owner: "denizlg24",
          repo: "site",
          base: "a",
          head: "b",
        })
      ).complete,
    ).toBe(false);
  });
});

describe("parseDeployCommand", () => {
  it("reads the verb and an optional target name", () => {
    expect(parseDeployCommand("@forge deploy", "forge")).toEqual({
      targetName: null,
    });
    expect(parseDeployCommand("@forge deploy web", "forge")).toEqual({
      targetName: "web",
    });
    expect(parseDeployCommand("@forge[bot] deploy `web`", "forge")).toEqual({
      targetName: "web",
    });
    expect(parseDeployCommand("@FORGE DEPLOY Web", "forge")).toEqual({
      targetName: "Web",
    });
  });

  it("keeps a multi-word target name whole", () => {
    expect(parseDeployCommand("@forge deploy admin api", "forge")).toEqual({
      targetName: "admin api",
    });
  });

  it("needs the verb, so talking about the bot builds nothing", () => {
    expect(parseDeployCommand("@forge", "forge")).toBeNull();
    expect(parseDeployCommand("thanks @forge!", "forge")).toBeNull();
    expect(parseDeployCommand("@forge status", "forge")).toBeNull();
    expect(parseDeployCommand("deploy this please", "forge")).toBeNull();
  });

  it("ignores another app's mention and an unset slug", () => {
    expect(parseDeployCommand("@other deploy", "forge")).toBeNull();
    expect(parseDeployCommand("@forge deploy", null)).toBeNull();
  });

  it("does not read a quoted command", () => {
    expect(parseDeployCommand("> @forge deploy\nagreed", "forge")).toBeNull();
    expect(
      parseDeployCommand("> @forge deploy\n@forge deploy web", "forge"),
    ).toEqual({ targetName: "web" });
  });

  it("finds a command later in the line", () => {
    expect(parseDeployCommand("looks good, @forge deploy", "forge")).toEqual({
      targetName: null,
    });
  });
});

describe("canRunDeployCommand", () => {
  it("admits the owner and nobody else", () => {
    expect(canRunDeployCommand("OWNER")).toBe(true);
    expect(canRunDeployCommand("MEMBER")).toBe(false);
    expect(canRunDeployCommand("COLLABORATOR")).toBe(false);
    expect(canRunDeployCommand("CONTRIBUTOR")).toBe(false);
    expect(canRunDeployCommand("NONE")).toBe(false);
    expect(canRunDeployCommand(null)).toBe(false);
  });
});

describe("GithubAppClient.getPullRequest", () => {
  function clientReturning(body: unknown, status = 200): GithubAppClient {
    return new GithubAppClient({
      config: {
        appId: "1",
        privateKey: "unused with a cached token",
        webhookSecret: "secret",
        slug: null,
      },
      cache: {
        get: async () => "installation-token",
        set: async () => {},
        delete: async () => {},
      },
      fetchImplementation: Object.assign(
        async () =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json" },
          }),
        { preconnect: () => {} },
      ),
    });
  }

  it("reports the head commit and which repository it is on", async () => {
    const client = clientReturning({
      number: 7,
      state: "open",
      draft: false,
      title: "Add a thing",
      head: {
        ref: "feature",
        sha: "b".repeat(40),
        repo: { full_name: "denizlg24/site" },
      },
      base: { repo: { full_name: "denizlg24/site" } },
    });

    await expect(
      client.getPullRequest({
        installationId: 1,
        owner: "denizlg24",
        repo: "site",
        number: 7,
      }),
    ).resolves.toEqual({
      number: 7,
      state: "open",
      draft: false,
      title: "Add a thing",
      headRef: "feature",
      headSha: "b".repeat(40),
      headRepoFullName: "denizlg24/site",
      baseRepoFullName: "denizlg24/site",
    });
  });

  it("is null for a pull request that is gone", async () => {
    const client = clientReturning({ message: "Not Found" }, 404);
    await expect(
      client.getPullRequest({
        installationId: 1,
        owner: "denizlg24",
        repo: "site",
        number: 7,
      }),
    ).resolves.toBeNull();
  });
});

describe("branchFromRef", () => {
  it("reads only branch refs", () => {
    expect(branchFromRef("refs/heads/main")).toBe("main");
    expect(branchFromRef("refs/heads/feat/a/b")).toBe("feat/a/b");
    expect(branchFromRef("refs/tags/v1")).toBeNull();
  });
});

describe("verifyGithubSignature", () => {
  const secret = "s3cret";
  const body = '{"zen":"Design for failure."}';
  const valid = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  it("accepts the signature GitHub sends", () => {
    expect(verifyGithubSignature(secret, body, valid)).toBe(true);
  });

  it("rejects a wrong secret, a wrong body and a missing header", () => {
    expect(verifyGithubSignature("other", body, valid)).toBe(false);
    expect(verifyGithubSignature(secret, `${body} `, valid)).toBe(false);
    expect(verifyGithubSignature(secret, body, null)).toBe(false);
    expect(verifyGithubSignature(secret, body, "")).toBe(false);
  });

  it("rejects a malformed header without throwing", () => {
    // timingSafeEqual throws on a length mismatch, so the length check has to
    // come first or a short header is a 500 instead of a rejection.
    expect(verifyGithubSignature(secret, body, "sha256=short")).toBe(false);
    expect(verifyGithubSignature(secret, body, "sha1=whatever")).toBe(false);
  });
});

describe("createAppJwt", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("backdates iat and stays inside GitHub's ten-minute ceiling", () => {
    const now = Date.parse("2026-08-07T12:00:00Z");
    const token = createAppJwt({
      appId: "12345",
      privateKey: pem,
      now: () => now,
    });
    const [, payload] = token.split(".");
    const claims = JSON.parse(
      Buffer.from(payload ?? "", "base64url").toString("utf8"),
    );
    const seconds = Math.floor(now / 1_000);
    // GitHub rejects an iat in its own future and says only "'Issued at' claim
    // is in the future"; a minute of slack is what buys past that.
    expect(claims.iat).toBe(seconds - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    expect(claims.iss).toBe("12345");
  });

  it("reads a base64-wrapped key as well as a raw PEM", () => {
    expect(readGithubPrivateKey(pem)).toBe(pem.trim());
    expect(readGithubPrivateKey(Buffer.from(pem).toString("base64"))).toContain(
      "-----BEGIN",
    );
    expect(() => readGithubPrivateKey("not-a-key")).toThrow();
  });
});
