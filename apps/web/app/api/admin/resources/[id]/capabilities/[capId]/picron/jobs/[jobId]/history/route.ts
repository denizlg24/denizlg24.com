import { type NextRequest, NextResponse } from "next/server";
import { getPiCronCredentials } from "@/lib/capabilities/picron";
import { connectDB } from "@/lib/mongodb";
import { type PiCronHistoryEntry, piCronFetch } from "@/lib/picron";
import { requireAdmin } from "@/lib/require-admin";
import { Resource } from "@/models/Resource";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; capId: string; jobId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id, capId, jobId } = await params;
    await connectDB();
    const resource = await Resource.findById(id);
    if (!resource)
      return NextResponse.json(
        { error: "Resource not found" },
        { status: 404 },
      );

    const cap = resource.capabilities.id(capId);
    if (!cap || cap.type !== "picron")
      return NextResponse.json(
        { error: "PiCron capability not found" },
        { status: 400 },
      );

    const { username, password } = getPiCronCredentials(cap);
    const history = await piCronFetch<PiCronHistoryEntry[]>(
      capId,
      cap.baseUrl,
      username,
      password,
      `/api/jobs/${jobId}/history`,
    );
    return NextResponse.json(history);
  } catch (error) {
    console.error("PiCron GET /history:", error);
    return NextResponse.json({ error: String(error) }, { status: 502 });
  }
}
