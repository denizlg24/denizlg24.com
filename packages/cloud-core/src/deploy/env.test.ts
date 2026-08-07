import { describe, expect, test } from "bun:test";

import type { DeployEnvVarRow } from "../db/schema";
import {
  assertBindingsResolvable,
  BindingUnresolvableError,
  collectReferences,
  type DeployBindingResolvers,
  describeBindings,
  resolveDeploymentEnv,
} from "./env";

function row(overrides: Partial<DeployEnvVarRow>): DeployEnvVarRow {
  return {
    id: crypto.randomUUID(),
    targetId: "00000000-0000-0000-0000-000000000001",
    key: "KEY",
    source: "literal",
    encryptedValue: null,
    valueIv: null,
    valueAuthTag: null,
    reference: null,
    template: null,
    scope: "all",
    buildTime: false,
    runTime: true,
    createdAt: new Date(),
    ...overrides,
  };
}

const deployment = {
  id: "d1",
  sha: "a".repeat(40),
  ref: "main",
  hostname: "app.denizlg24.com",
  kind: "production" as const,
};

const project = { slug: "app", name: "App" };

function resolvers(
  overrides: Partial<DeployBindingResolvers> = {},
): DeployBindingResolvers {
  return {
    "database.postgres": async () => ({
      url: "postgresql://u:p@postgres.denizlg24.com:5433/app",
      host: "postgres.denizlg24.com",
      port: "5433",
      user: "u",
      password: "p",
      database: "app",
    }),
    "database.mongodb": async () => null,
    "database.redis": async () => null,
    s3: async () => {
      throw new Error("s3 must not be resolved");
    },
    ...overrides,
  };
}

const decrypt = (candidate: DeployEnvVarRow) => `plain:${candidate.key}`;

describe("collectReferences", () => {
  test("gathers binding and template references with their keys", () => {
    const collected = collectReferences([
      row({ key: "A", source: "binding", reference: "database.postgres.url" }),
      row({
        key: "B",
        source: "template",
        template: "${database.postgres.user}:${database.postgres.password}",
      }),
      row({ key: "C", source: "literal", encryptedValue: "x" }),
    ]);
    expect([...collected.keys()].sort()).toEqual([
      "database.postgres.password",
      "database.postgres.url",
      "database.postgres.user",
    ]);
    expect(collected.get("database.postgres.url")).toEqual(["A"]);
  });
});

describe("assertBindingsResolvable", () => {
  const available = { postgres: true, mongodb: false, redis: false };

  test("passes when every reference names a provisioned namespace", () => {
    expect(() =>
      assertBindingsResolvable(
        [
          row({
            key: "A",
            source: "binding",
            reference: "database.postgres.url",
          }),
        ],
        available,
      ),
    ).not.toThrow();
  });

  test("names the offending key when the namespace is not provisioned", () => {
    try {
      assertBindingsResolvable(
        [
          row({
            key: "MONGODB_URI",
            source: "binding",
            reference: "database.mongodb.url",
          }),
        ],
        available,
      );
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(BindingUnresolvableError);
      const failure = error as BindingUnresolvableError;
      expect(failure.code).toBe("BINDING_UNRESOLVABLE");
      expect(failure.keys).toEqual(["MONGODB_URI"]);
      expect(failure.references).toEqual(["database.mongodb.url"]);
    }
  });

  test("rejects a template reference outside the vocabulary", () => {
    expect(() =>
      assertBindingsResolvable(
        [
          row({
            key: "DATABASE_URL",
            source: "template",
            template: "postgres://${database.postgres.urL}",
          }),
        ],
        available,
      ),
    ).toThrow(BindingUnresolvableError);
  });

  test("s3 needs no provisioning", () => {
    expect(() =>
      assertBindingsResolvable(
        [
          row({
            key: "S3_ACCESS_KEY_ID",
            source: "binding",
            reference: "s3.accessKeyId",
          }),
        ],
        available,
      ),
    ).not.toThrow();
  });
});

describe("resolveDeploymentEnv", () => {
  test("injects only PORT and NODE_ENV when nothing is bound", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [],
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(resolved.runEnv).toEqual({ PORT: "3000", NODE_ENV: "production" });
    expect(resolved.buildEnv).toEqual({});
  });

  test("never resolves a namespace nothing references", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [row({ key: "SENTRY_DSN", encryptedValue: "x" })],
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(resolved.runEnv.SENTRY_DSN).toBe("plain:SENTRY_DSN");
  });

  test("a binding is a rename", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [
        row({
          key: "POSTGRES_PRISMA_URL",
          source: "binding",
          reference: "database.postgres.url",
        }),
      ],
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(resolved.runEnv.POSTGRES_PRISMA_URL).toBe(
      "postgresql://u:p@postgres.denizlg24.com:5433/app",
    );
  });

  test("a template reshapes over the same namespace", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [
        row({
          key: "DATABASE_URL",
          source: "template",
          template:
            "postgresql://${database.postgres.user}:${database.postgres.password}@${database.postgres.host}:${database.postgres.port}/${database.postgres.database}?sslmode=require",
        }),
      ],
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(resolved.runEnv.DATABASE_URL).toBe(
      "postgresql://u:p@postgres.denizlg24.com:5433/app?sslmode=require",
    );
  });

  test("deployment.url carries this deployment's own hostname", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [
        row({
          key: "NEXT_PUBLIC_API_URL",
          source: "template",
          template: "${deployment.url}/api",
        }),
      ],
      deployment: { ...deployment, hostname: "app-pr-12-a1b2c3.denizlg24.com" },
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(resolved.buildEnv.NEXT_PUBLIC_API_URL).toBe(
      "https://app-pr-12-a1b2c3.denizlg24.com/api",
    );
  });

  test("NEXT_PUBLIC_* reaches the build even without the flag", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [
        row({ key: "NEXT_PUBLIC_X", encryptedValue: "x", buildTime: false }),
        row({ key: "PRIVATE_X", encryptedValue: "x", buildTime: false }),
      ],
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(resolved.buildKeys).toEqual(["NEXT_PUBLIC_X"]);
    expect(resolved.runKeys).toEqual([
      "NEXT_PUBLIC_X",
      "NODE_ENV",
      "PORT",
      "PRIVATE_X",
    ]);
  });

  test("scope narrows a row to one deployment kind", async () => {
    const rows = [
      row({ key: "A", encryptedValue: "x", scope: "preview" }),
      row({ key: "B", encryptedValue: "x", scope: "production" }),
    ];
    const production = await resolveDeploymentEnv({
      rows,
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(production.runEnv.A).toBeUndefined();
    expect(production.runEnv.B).toBe("plain:B");
  });

  test("an explicit row wins over Envoy", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [row({ key: "SHARED", encryptedValue: "x" })],
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
      envoy: { SHARED: "from-envoy", ONLY_ENVOY: "kept" },
    });
    expect(resolved.runEnv.SHARED).toBe("plain:SHARED");
    expect(resolved.runEnv.ONLY_ENVOY).toBe("kept");
    expect(resolved.buildEnv.ONLY_ENVOY).toBe("kept");
  });

  test("a row with both flags off lands in neither map", async () => {
    const resolved = await resolveDeploymentEnv({
      rows: [
        row({
          key: "DISABLED",
          encryptedValue: "x",
          buildTime: false,
          runTime: false,
        }),
      ],
      deployment,
      project,
      resolvers: resolvers(),
      decrypt,
    });
    expect(resolved.buildEnv.DISABLED).toBeUndefined();
    expect(resolved.runEnv.DISABLED).toBeUndefined();
  });

  test("an unprovisioned namespace fails with the key that wanted it", async () => {
    await expect(
      resolveDeploymentEnv({
        rows: [
          row({
            key: "MONGODB_URI",
            source: "binding",
            reference: "database.mongodb.url",
          }),
        ],
        deployment,
        project,
        resolvers: resolvers(),
        decrypt,
      }),
    ).rejects.toThrow(BindingUnresolvableError);
  });

  test("s3 is only issued when something references it", async () => {
    let issued = 0;
    const resolved = await resolveDeploymentEnv({
      rows: [
        row({
          key: "S3_ACCESS_KEY_ID",
          source: "binding",
          reference: "s3.accessKeyId",
        }),
      ],
      deployment,
      project,
      resolvers: resolvers({
        s3: async () => {
          issued += 1;
          return {
            endpoint: "https://api.denizlg24.com/v2",
            region: "auto",
            bucket: "app",
            accessKeyId: "AKIA",
            secretAccessKey: "shh",
          };
        },
      }),
      decrypt,
    });
    expect(issued).toBe(1);
    expect(resolved.runEnv.S3_ACCESS_KEY_ID).toBe("AKIA");
  });

  test("a namespace referenced twice is resolved once", async () => {
    let calls = 0;
    await resolveDeploymentEnv({
      rows: [
        row({
          key: "A",
          source: "binding",
          reference: "database.postgres.url",
        }),
        row({
          key: "B",
          source: "binding",
          reference: "database.postgres.host",
        }),
      ],
      deployment,
      project,
      resolvers: resolvers({
        "database.postgres": async () => {
          calls += 1;
          return { url: "u", host: "h" };
        },
      }),
      decrypt,
    });
    expect(calls).toBe(1);
  });
});

describe("describeBindings", () => {
  test("lists unavailable references rather than hiding them", () => {
    const described = describeBindings({
      postgres: true,
      mongodb: false,
      redis: false,
    });
    const mongo = described.find(
      (entry) => entry.reference === "database.mongodb.url",
    );
    expect(mongo?.available).toBe(false);
    expect(mongo?.secret).toBe(true);
    expect(
      described.find((entry) => entry.reference === "project.slug")?.secret,
    ).toBe(false);
  });
});
