import { connectDB } from "@/lib/mongodb";
import { RateLimit } from "@/models/RateLimit";

export async function checkRateLimit(
  key: string,
  {
    maxRequests = 20,
    windowMs = 60_000,
  }: { maxRequests?: number; windowMs?: number } = {},
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  await connectDB();

  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  const doc = await RateLimit.findOneAndUpdate(
    { key },
    [
      {
        $set: {
          timestamps: {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ["$timestamps", []] },
                  as: "t",
                  cond: { $gt: ["$$t", windowStart] },
                },
              },
              [now],
            ],
          },
        },
      },
    ],
    { upsert: true, returnDocument: "after", updatePipeline: true },
  );

  const count = doc?.timestamps?.length ?? 1;

  if (count > maxRequests) {
    await RateLimit.updateOne({ key }, { $pop: { timestamps: 1 } });

    const oldest = doc?.timestamps?.[0];
    const resetMs = oldest
      ? oldest.getTime() + windowMs - now.getTime()
      : windowMs;

    return { allowed: false, remaining: 0, resetMs: Math.max(resetMs, 0) };
  }

  return {
    allowed: true,
    remaining: maxRequests - count,
    resetMs: windowMs,
  };
}
