import { workJobUpdateSchema } from "@repo/schemas";
import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { serializeWorkJob, updateWorkJob } from "@/lib/work-hours";
import { hoursErrorResponse } from "../../errors";

type Context = { params: Promise<{ id: string }> };

/** Jobs are archived, never deleted: their shifts are the payout history. */
export async function PATCH(request: NextRequest, context: Context) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const { id } = await context.params;
  if (!mongoose.isValidObjectId(id)) {
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  }
  const parsed = workJobUpdateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid job" }, { status: 400 });
  }
  try {
    const job = await updateWorkJob(id, parsed.data);
    if (!job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    return NextResponse.json({ job: serializeWorkJob(job) });
  } catch (error) {
    return hoursErrorResponse(error, "Failed to update job");
  }
}
