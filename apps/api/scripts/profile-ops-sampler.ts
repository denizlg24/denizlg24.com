import { createDb, DockerClient } from "@repo/cloud-core";

import { MetricsSampler } from "../src/ops/sampler";

const databaseUrl =
  process.env.CLOUD_TEST_DATABASE_URL ??
  "postgresql://denizcloud:devpassword@localhost:5433/denizcloud";
const dockerHost =
  process.env.CLOUD_TEST_DOCKER_HOST ?? "http://127.0.0.1:23750";
const samples = Number(process.env.OPS_PROFILE_SAMPLES ?? 10);
if (!Number.isInteger(samples) || samples < 2 || samples > 100) {
  throw new Error("OPS_PROFILE_SAMPLES must be an integer from 2 to 100");
}

const db = createDb(databaseUrl, { max: 2 });
const sampler = new MetricsSampler({
  db,
  docker: new DockerClient(dockerHost),
  devices: [],
});

try {
  Bun.gc(true);
  const baseline = process.memoryUsage().rss;
  let peak = baseline;
  for (let index = 0; index < samples; index += 1) {
    await sampler.sample();
    Bun.gc(true);
    peak = Math.max(peak, process.memoryUsage().rss);
  }
  const deltaBytes = Math.max(0, peak - baseline);
  console.log(
    JSON.stringify({
      samples,
      baselineBytes: baseline,
      peakBytes: peak,
      deltaBytes,
      withinBudget: deltaBytes <= 50 * 1_024 * 1_024,
    }),
  );
  if (deltaBytes > 50 * 1_024 * 1_024) process.exitCode = 1;
} finally {
  sampler.stop();
  await db.$client.end();
}
