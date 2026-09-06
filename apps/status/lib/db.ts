import { MongoClient } from "mongodb";
import type {
  Backup,
  Command,
  Daily,
  Incident,
  Maintenance,
  Sample,
  Snapshot,
  Timing,
} from "./model";

let clientPromise: Promise<MongoClient> | undefined;
export async function database() {
  const uri = process.env.STATUS_MONGODB_URI;
  if (!uri) throw new Error("STATUS_MONGODB_URI is not configured");
  clientPromise ??= new MongoClient(uri, {
    maxPoolSize: 5,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 5_000,
    socketTimeoutMS: 10_000,
    appName: "deniz-status",
  })
    .connect()
    .catch((error) => {
      clientPromise = undefined;
      throw error;
    });
  const client = await clientPromise;
  return client.db(process.env.STATUS_MONGODB_DATABASE ?? "deniz_status");
}
export async function collections() {
  const db = await database();
  return {
    snapshots: db.collection<Snapshot>("status_snapshots"),
    samples: db.collection<Sample>("status_samples"),
    daily: db.collection<Daily & { _id: string; expiresAt: Date }>(
      "status_daily",
    ),
    timings: db.collection<Timing>("status_timings"),
    incidents: db.collection<Incident>("status_incidents"),
    maintenance: db.collection<Maintenance>("status_maintenance"),
    backups: db.collection<Backup & { _id: string }>("status_backups"),
    backupRuns: db.collection<Backup & { _id: string; expiresAt: Date }>(
      "status_backup_runs",
    ),
    commands: db.collection<Command>("status_commands"),
    audit: db.collection<{
      _id: string;
      at: Date;
      actor: string;
      action: string;
      target: string;
      outcome: string;
    }>("status_audit"),
    leases: db.collection<{ _id: string; owner: string; until: Date }>(
      "status_leases",
    ),
  };
}
export async function setupDatabase() {
  const c = await collections();
  await Promise.all([
    c.samples.createIndex({ serviceId: 1, at: -1 }),
    c.samples.createIndex({ at: 1 }, { expireAfterSeconds: 7 * 86400 }),
    c.timings.createIndex({ serviceId: 1, region: 1, at: -1 }),
    c.timings.createIndex({ at: 1 }, { expireAfterSeconds: 32 * 86400 }),
    c.daily.createIndex({ day: 1, serviceId: 1 }),
    c.daily.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.incidents.createIndex({ startedAt: -1 }),
    c.incidents.createIndex({ resolvedAt: 1 }),
    c.maintenance.createIndex({ endsAt: -1 }),
    c.backupRuns.createIndex({ id: 1, startedAt: -1 }),
    c.backupRuns.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    c.commands.createIndex({ profile: 1, state: 1, createdAt: 1 }),
    c.commands.createIndex(
      { profile: 1, job: 1 },
      {
        unique: true,
        partialFilterExpression: { state: { $in: ["queued", "claimed"] } },
      },
    ),
    c.audit.createIndex({ at: -1 }),
  ]);
}
