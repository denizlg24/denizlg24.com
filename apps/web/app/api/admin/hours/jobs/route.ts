import { workJobInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import {
  createWorkJob,
  listWorkJobs,
  serializeWorkJob,
} from "@/lib/work-hours";
import { hoursErrorResponse } from "../errors";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const jobs = await listWorkJobs();
    return NextResponse.json({ jobs: jobs.map(serializeWorkJob) });
  } catch (error) {
    return hoursErrorResponse(error, "Failed to list jobs");
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = workJobInputSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  }
  try {
    const job = await createWorkJob(parsed.data);
    return NextResponse.json({ job: serializeWorkJob(job) }, { status: 201 });
  } catch (error) {
    return hoursErrorResponse(error, "Failed to create job");
  }
}
