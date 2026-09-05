/** Reconcile the observed infrastructure with the website status inventory.
 * bun --env-file=../../.env.prod scripts/configure-dr-monitoring.ts [--execute]
 * DR_SYNTHETIC_TOKEN_FILE names the private API token file (never a URL query).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import mongoose from "mongoose";
import { encryptSecret } from "../lib/encrypted-secret";
import { DR_DEEP_HEALTH_URL } from "../lib/health-check-credential";
import { connectDB } from "../lib/mongodb";
import { connectResourceDB } from "../lib/mongodb-resource";
import { Resource } from "../models/Resource";
import { getPingResourceModel } from "../models/resource-db/PingResource";
import {
  getSubResourceModel,
  type ISubResourceHttpCheck,
} from "../models/resource-db/SubResource";

const execute = process.argv.includes("--execute");
const deep = (path: string): ISubResourceHttpCheck => ({
  type: "http",
  url: DR_DEEP_HEALTH_URL,
  credentialId: "dr-synthetic",
  expectStatus: 200,
  expectJsonPath: path,
  expectEquals: "ok",
});
const http = (url: string): ISubResourceHttpCheck => ({
  type: "http",
  url,
  expectStatus: 200,
  expectJsonPath: null,
  expectEquals: null,
});

try {
  await connectDB();
  const db = await connectResourceDB();
  const PingResource = await getPingResourceModel();
  const SubResource = await getSubResourceModel();
  const resources = await Resource.find().lean();
  function parent(name: string) {
    const matches = resources.filter((r) => r.name === name);
    if (matches.length !== 1)
      throw new Error(`Expected exactly one resource named ${name}`);
    return matches[0]!;
  }
  const pi = parent("Pi-Cloud");
  const forge = parent("Forge Server");
  const retired = parent("Pi-One");
  const zero = parent("Pi-Two");
  const checks = [
    ...[
      ["PostgreSQL", "checks.postgres.status"],
      ["MongoDB", "checks.mongodb.status"],
      ["Redis", "checks.redis.status"],
      ["Meilisearch", "checks.search.status"],
      ["POSIX Namespace", "checks.posix.status"],
      ["Project Object Storage", "checks.objectStorage.status"],
      ["Storage Upload and Range", "checks.storageProtocol.status"],
      ["Dependency Transactions", "status"],
    ].map(([name, path]) => ({
      parentResourceId: pi._id,
      name: name!,
      check: deep(path!),
    })),
    {
      parentResourceId: forge._id,
      name: "Deployment Dashboard",
      check: http("https://forge.denizlg24.com"),
    },
    {
      parentResourceId: forge._id,
      name: "Production Routing",
      check: http("https://oceaninformatix.com"),
    },
  ];
  // Probe before changing any records; authentication failure is a hard stop.
  const token = (
    await readFile(
      process.env.DR_SYNTHETIC_TOKEN_FILE ??
        join(homedir(), ".config/deniz-dr/synthetic-token"),
      "utf8",
    )
  ).trim();
  const response = await fetch(DR_DEEP_HEALTH_URL, {
    headers: { "X-DR-Synthetic-Token": token },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  const result = (await response.json()) as {
    status?: string;
    checks?: Record<string, { status: string }>;
  };
  if (
    ![200, 503].includes(response.status) ||
    !result.checks ||
    ![
      "postgres",
      "mongodb",
      "redis",
      "search",
      "posix",
      "objectStorage",
      "storageProtocol",
    ].every((name) =>
      ["ok", "down"].includes(result.checks?.[name]?.status ?? ""),
    )
  ) {
    throw new Error("Authenticated deep health contract did not validate");
  }
  if (execute) {
    const backupRoot = join(homedir(), ".config/deniz-dr/monitoring-changes");
    await mkdir(backupRoot, { recursive: true, mode: 0o700 });
    await writeFile(
      join(backupRoot, `${Date.now()}-before.json`),
      JSON.stringify({
        resources,
        pingresources: await PingResource.find().lean(),
        subresources: await SubResource.find().lean(),
        credentials: await db
          .collection("healthcheckcredentials")
          .find()
          .toArray(),
      }),
      { mode: 0o600, flag: "wx" },
    );
    await db
      .collection("healthcheckcredentials")
      .updateOne(
        { _id: "dr-synthetic" as never },
        { $set: { secret: encryptSecret(token), updatedAt: new Date() } },
        { upsert: true },
      );
    const retireUpdate = {
      $set: { isActive: false, "agentService.enabled": false },
    };
    await Resource.updateOne({ _id: retired._id }, retireUpdate);
    await PingResource.updateOne({ _id: retired._id }, retireUpdate);
    await Resource.updateOne({ _id: zero._id }, { $set: { isActive: true } });
    await PingResource.updateOne(
      { _id: zero._id },
      { $set: { isActive: true } },
    );
    await Resource.updateOne(
      { _id: retired._id },
      {
        $set: {
          description:
            "Retired Pi Zero. No active workloads or tailnet membership.",
        },
      },
    );
    await Resource.updateOne(
      { _id: zero._id },
      {
        $set: {
          description:
            "Live Pi Zero outside Tailscale; resource agent only, no application workloads.",
        },
      },
    );
    await SubResource.updateMany(
      { parentResourceId: retired._id },
      { $set: { isActive: false } },
    );
    for (const row of checks) {
      const identity = {
        parentResourceId: row.parentResourceId,
        name: row.name,
      };
      if ((await SubResource.countDocuments(identity)) > 1)
        throw new Error(`Duplicate check: ${row.name}`);
      await SubResource.updateOne(
        identity,
        {
          $set: {
            ...row,
            isActive: true,
            isPublic: true,
            description: row.check.credentialId
              ? "Authenticated dependency transaction; same endpoint as Better Stack."
              : "Public route monitored by Better Stack.",
          },
        },
        { upsert: true, runValidators: true },
      );
    }
  }
  console.log(
    JSON.stringify(
      {
        writes: execute,
        retired: retired.name,
        retained: zero.name,
        checks: checks.map(({ name, check }) => ({ name, ...check })),
        deepHealth: Object.fromEntries(
          Object.entries(result.checks).map(([name, check]) => [
            name,
            check.status,
          ]),
        ),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Monitoring reconciliation failed",
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
