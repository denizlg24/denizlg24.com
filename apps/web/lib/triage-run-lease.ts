import { connectDB } from "@/lib/mongodb";
import { TriageRunLeaseModel } from "@/models/TriageRunLease";

// Active workers renew this every 30 seconds. A process that is SIGKILLed,
// crashes, or loses its host therefore blocks another run for at most 90
// seconds instead of the full job duration.
const DEFAULT_LEASE_MS = 90 * 1_000;

async function ensureLeaseDocument(): Promise<void> {
  try {
    await TriageRunLeaseModel.updateOne(
      { _id: "singleton" },
      { $setOnInsert: { expiresAt: new Date(0) } },
      { upsert: true },
    );
  } catch (error) {
    if (
      typeof error !== "object" ||
      error === null ||
      !("code" in error) ||
      error.code !== 11_000
    ) {
      throw error;
    }
  }
}

async function acquireLease(owner: string, leaseMs: number): Promise<boolean> {
  await connectDB();
  await ensureLeaseDocument();
  const now = new Date();
  const lease = await TriageRunLeaseModel.findOneAndUpdate(
    {
      _id: "singleton",
      $or: [
        { owner },
        { owner: { $exists: false } },
        { expiresAt: { $lte: now } },
      ],
    },
    {
      $set: {
        owner,
        expiresAt: new Date(now.getTime() + leaseMs),
      },
    },
    { returnDocument: "after" },
  ).lean();
  return lease?.owner === owner;
}

async function renewLease(owner: string, leaseMs: number): Promise<boolean> {
  const result = await TriageRunLeaseModel.updateOne(
    { _id: "singleton", owner },
    { $set: { expiresAt: new Date(Date.now() + leaseMs) } },
  );
  return result.matchedCount === 1;
}

export async function releaseTriageRunLease(owner: string): Promise<boolean> {
  await connectDB();
  const result = await TriageRunLeaseModel.updateOne(
    { _id: "singleton", owner },
    {
      $set: { expiresAt: new Date(0) },
      $unset: { owner: 1 },
    },
  );
  return result.modifiedCount === 1;
}

export async function resetTriageRunLease(): Promise<{
  owner?: string;
  expiresAt?: Date;
}> {
  await connectDB();
  const previous = await TriageRunLeaseModel.findOneAndUpdate(
    { _id: "singleton" },
    {
      $set: { expiresAt: new Date(0) },
      $unset: { owner: 1 },
    },
    { returnDocument: "before" },
  ).lean();
  return {
    owner: previous?.owner,
    expiresAt: previous?.expiresAt,
  };
}

export async function withTriageRunLease<T>(
  owner: string,
  task: () => Promise<T>,
  leaseMs = DEFAULT_LEASE_MS,
): Promise<{ acquired: false } | { acquired: true; result: T }> {
  const acquired = await acquireLease(owner, leaseMs);
  if (!acquired) return { acquired: false };

  // A renewal that matches nothing means the lease expired and another worker
  // took it. Two runs are now walking the same candidate set, so say so loudly
  // rather than letting the loser finish silently.
  let lost = false;
  const heartbeat = setInterval(
    () => {
      void renewLease(owner, leaseMs)
        .then((renewed) => {
          if (renewed || lost) return;
          lost = true;
          console.error(
            `Triage run lease ${owner} was lost — another worker holds it; this run is now a duplicate.`,
          );
        })
        .catch((error) => {
          console.error("Failed to renew triage run lease:", error);
        });
    },
    Math.max(1_000, Math.floor(leaseMs / 3)),
  );
  heartbeat.unref();

  try {
    return { acquired: true, result: await task() };
  } finally {
    clearInterval(heartbeat);
    // Releasing after the lease was lost would clear the new owner's lease.
    if (!lost) {
      await releaseTriageRunLease(owner).catch((error) => {
        console.error("Failed to release triage run lease:", error);
      });
    }
  }
}
