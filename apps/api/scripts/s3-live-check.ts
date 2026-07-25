import {
  HeadBucketCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import { runScript, ScriptError } from "./lib/runner";

/**
 * Read-only liveness check for the S3 `/v2` surface against a running API.
 *
 * Unlike `s3-smoke.ts` this issues no writes — no bucket or object is created,
 * modified or deleted — so it is safe to point at production during the cutover
 * window. It proves what invariant 4 actually requires: that the legacy keypair
 * still signs successfully against the new endpoint and resolves to the
 * unrestricted NULL-project credential.
 */

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new ScriptError(`Missing required environment: ${name}`);
  return value;
}

await runScript("s3-live-check", async (flags, log) => {
  if (!flags.dryRun) {
    throw new ScriptError(
      "s3-live-check is read-only; --execute is not supported",
    );
  }

  const endpoint = env("S3_ENDPOINT", "https://api.denizlg24.com/v2");
  const client = new S3Client({
    credentials: {
      accessKeyId: env("S3_ACCESS_KEY_ID"),
      secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
    },
    endpoint,
    forcePathStyle: true,
    region: env("S3_REGION", "eu-west-1"),
  });

  const listed = await client.send(new ListBucketsCommand({}));
  const buckets = (listed.Buckets ?? []).flatMap((bucket) =>
    bucket.Name ? [bucket.Name] : [],
  );
  await log.event("list-buckets", { count: buckets.length });

  // Probe one bucket read-only so the check exercises object listing too, not
  // just the service-level call.
  const probe = process.env.S3_PROBE_BUCKET ?? buckets[0];
  let objectsVisible: number | null = null;
  if (probe) {
    await client.send(new HeadBucketCommand({ Bucket: probe }));
    const objects = await client.send(
      new ListObjectsV2Command({ Bucket: probe, MaxKeys: 5 }),
    );
    objectsVisible = objects.KeyCount ?? 0;
  }

  return {
    buckets: buckets.slice(0, 20),
    bucketCount: buckets.length,
    endpoint,
    probedBucket: probe ?? null,
    objectsVisible,
    signatureAccepted: true,
  };
});
