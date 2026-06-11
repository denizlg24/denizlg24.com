/**
 * One-time (idempotent) migration:
 * - Mirrors essential ping fields from main `Resource` collection to the
 *   resource-DB `PingResource` collection.
 * - Copies `HealthCheckLog` documents from main DB to resource DB.
 *
 * Usage: bun run scripts/migrate-ping-resources.ts
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { connectResourceDB } from "@/lib/mongodb-resource";
import { HealthCheckLog as MainHealthCheckLog } from "@/models/HealthCheckLog";
import { getHealthCheckLogModel } from "@/models/resource-db/HealthCheckLog";
import { getPingResourceModel } from "@/models/resource-db/PingResource";
import { Resource } from "@/models/Resource";

async function migrateResources() {
  console.log("→ Mirroring Resources to PingResource…");
  const PingResource = await getPingResourceModel();
  const resources = await Resource.find().lean();

  let upserted = 0;
  for (const r of resources) {
    const agent = r.agentService;
    await PingResource.findByIdAndUpdate(
      r._id,
      {
        $set: {
          name: r.name,
          url: r.url,
          isActive: r.isActive,
          isPublic: r.isPublic ?? true,
          "agentService.enabled": agent?.enabled ?? false,
          "agentService.nodeId": agent?.nodeId ?? "",
          "agentService.hmacSecret": agent?.hmacSecret ?? null,
          "agentService.lastCheckedAt": agent?.lastCheckedAt ?? null,
          "agentService.lastStatus": agent?.lastStatus ?? null,
          "agentService.lastMetrics": agent?.lastMetrics ?? null,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
    upserted++;
  }
  console.log(`  ✓ ${upserted} resources upserted`);
}

async function migrateLogs() {
  console.log("→ Copying HealthCheckLog → resource DB…");
  const TargetLog = await getHealthCheckLogModel();

  const BATCH = 1000;
  let copied = 0;
  let skipped = 0;
  let cursor = MainHealthCheckLog.find().lean().cursor();

  let batch: any[] = [];
  for await (const doc of cursor) {
    batch.push(doc);
    if (batch.length >= BATCH) {
      const res = await TargetLog.insertMany(batch, { ordered: false }).catch(
        (err) => {
          // duplicate _id (idempotent re-runs) → skip silently
          if (err?.code === 11000 || err?.writeErrors) {
            skipped += err.writeErrors?.length ?? 0;
            return err.insertedDocs ?? [];
          }
          throw err;
        },
      );
      copied += Array.isArray(res) ? res.length : 0;
      batch = [];
      console.log(`  · ${copied} copied, ${skipped} skipped`);
    }
  }
  if (batch.length > 0) {
    const res = await TargetLog.insertMany(batch, { ordered: false }).catch(
      (err) => {
        if (err?.code === 11000 || err?.writeErrors) {
          skipped += err.writeErrors?.length ?? 0;
          return err.insertedDocs ?? [];
        }
        throw err;
      },
    );
    copied += Array.isArray(res) ? res.length : 0;
  }

  console.log(`  ✓ ${copied} logs copied, ${skipped} duplicates skipped`);
}

async function main() {
  console.log("Connecting to main DB…");
  await connectDB();
  console.log("Connecting to resource DB…");
  await connectResourceDB();

  await migrateResources();
  await migrateLogs();

  console.log("\nDone.");
  await mongoose.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
