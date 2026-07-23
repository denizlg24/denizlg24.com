import { describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Meilisearch } from "meilisearch";

import {
  createProjectSearchKey,
  deleteProjectSearchKey,
  generateProjectToken,
  validateSearchRules,
} from "./tokens";

describe("project search credentials", () => {
  it("creates a key restricted to the project wildcard", async () => {
    let received: Parameters<Meilisearch["createKey"]>[0] | undefined;
    const result = await createProjectSearchKey(
      {
        async createKey(input) {
          received = input;
          return {
            key: "project-secret",
            uid: "project-key-id",
          };
        },
      },
      "my-project",
    );

    expect(result).toEqual({
      key: "project-secret",
      uid: "project-key-id",
    });
    expect(received?.indexes).toEqual(["my-project_*"]);
    expect(received?.expiresAt).toBeNull();
    expect(received?.actions).toContain("search");
    expect(received?.actions).toContain("documents.add");
    expect(received?.actions).not.toContain("keys.create");
  });

  it("deletes a key by uid", async () => {
    const deleted: string[] = [];
    await deleteProjectSearchKey(
      {
        async deleteKey(uid) {
          deleted.push(uid);
        },
      },
      "key-id",
    );
    expect(deleted).toEqual(["key-id"]);
  });

  it("generates a tenant JWT and rejects invalid key uids", async () => {
    const token = await generateProjectToken({
      apiKey: "key-for-token-signing",
      apiKeyUid: randomUUID(),
      projectName: "my-project",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(token.split(".")).toHaveLength(3);

    await expect(
      generateProjectToken({
        apiKey: "key-for-token-signing",
        apiKeyUid: "not-a-uuid",
        projectName: "my-project",
      }),
    ).rejects.toThrow("UUIDv4");
  });

  it("rejects search rules outside the project prefix", () => {
    expect(
      validateSearchRules(
        {
          "my-project_users": null,
          "my-project_orders": { filter: "tenant_id = 1" },
        },
        "my-project",
      ),
    ).toBeNull();

    expect(validateSearchRules({ other_users: null }, "my-project")).toContain(
      "outside project scope",
    );
  });

  it("rejects out-of-scope rules before signing a tenant token", async () => {
    await expect(
      generateProjectToken({
        apiKey: "key-for-token-signing",
        apiKeyUid: randomUUID(),
        projectName: "my-project",
        searchRules: { other_users: null },
      }),
    ).rejects.toThrow("outside project scope");
  });
});
