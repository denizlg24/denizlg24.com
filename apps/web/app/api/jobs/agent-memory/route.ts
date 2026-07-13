import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  completeMemoryJob,
  failMemoryJob,
  leaseNextMemoryJob,
} from "@/lib/agent-memory/jobs";

const MAX_JOBS_PER_REQUEST = 10;

export async function POST(request: Request) {
  const token = process.env.AGENT_MEMORY_JOB_BEARER_TOKEN;
  if (!token || request.headers.get("Authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId = `job-route:${randomUUID()}`;
  let completed = 0;
  let failed = 0;
  for (let index = 0; index < MAX_JOBS_PER_REQUEST; index += 1) {
    const job = await leaseNextMemoryJob({
      workerId,
      operations: ["deletion"],
    });
    if (!job) break;
    try {
      // Gate A deletion jobs currently perform their synchronous exclusion and
      // embedding cleanup in governance. The durable item records completion;
      // later gates add bounded operation handlers here.
      await completeMemoryJob(job._id.toString(), workerId);
      completed += 1;
    } catch (error) {
      await failMemoryJob({
        jobId: job._id.toString(),
        workerId,
        attempt: job.attempts,
        error,
      });
      failed += 1;
    }
  }
  return NextResponse.json({ completed, failed });
}
