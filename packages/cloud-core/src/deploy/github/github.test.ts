import { describe, expect, it } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";

import type {
  GithubPullRequestEvent,
  GithubPushEvent,
} from "@repo/schemas/cloud";

import {
  branchFromRef,
  planPullRequestDeployment,
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

describe("planPullRequestDeployment", () => {
  it("carries the pull request number a push cannot know", () => {
    expect(planPullRequestDeployment(pullRequest(), target)).toEqual({
      kind: "preview",
      ref: "feature",
      sha: "b".repeat(40),
      message: "Add a thing",
      prNumber: 7,
    });
  });

  it("ignores actions that are not a new commit", () => {
    for (const action of ["closed", "labeled", "edited", "assigned"]) {
      expect(planPullRequestDeployment(pullRequest({ action }), target)).toBe(
        null,
      );
    }
  });

  it("skips a draft until it is marked ready", () => {
    const draft = { head: { ref: "f", sha: "c" }, title: null, draft: true };
    expect(
      planPullRequestDeployment(pullRequest({ pull_request: draft }), target),
    ).toBeNull();
    expect(
      planPullRequestDeployment(
        pullRequest({ action: "ready_for_review", pull_request: draft }),
        target,
      )?.kind,
    ).toBe("preview");
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
