import { startWorker } from "@/lib/jobs/worker";

const positive = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

await startWorker({
  concurrency: positive(process.env.WORKER_CONCURRENCY, 4),
  port: positive(process.env.PORT, 3000),
});
