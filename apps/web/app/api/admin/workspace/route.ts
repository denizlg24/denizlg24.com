import { workspaceSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { DesktopWorkspace } from "@/models/DesktopWorkspace";

const SINGLETON = "singleton";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const doc = await DesktopWorkspace.findById(SINGLETON).lean().exec();
    const parsed = workspaceSchema.safeParse(doc?.data);
    return NextResponse.json({
      workspace: parsed.success ? parsed.data : null,
    });
  } catch (error) {
    console.error("Failed to load workspace:", error);
    return NextResponse.json(
      { error: "Failed to load workspace" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = workspaceSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid workspace", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }

  try {
    await connectDB();
    const savedAt = parsed.data.savedAt ?? new Date().toISOString();
    await DesktopWorkspace.updateOne(
      { _id: SINGLETON },
      { $set: { data: { ...parsed.data, savedAt } } },
      { upsert: true },
    ).exec();
    return NextResponse.json({ savedAt });
  } catch (error) {
    console.error("Failed to save workspace:", error);
    return NextResponse.json(
      { error: "Failed to save workspace" },
      { status: 500 },
    );
  }
}
