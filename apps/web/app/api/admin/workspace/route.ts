import {
  type Workspace,
  workspaceSaveSchema,
  workspaceSchema,
} from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { DesktopWorkspace } from "@/models/DesktopWorkspace";

const SINGLETON = "singleton";

async function loadStored() {
  const doc = await DesktopWorkspace.findById(SINGLETON).lean().exec();
  if (!doc) return null;
  const parsed = workspaceSchema.safeParse(doc.data);
  return { savedAt: doc.data?.savedAt ?? null, workspace: parsed.data ?? null };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const stored = await loadStored();
    return NextResponse.json({ workspace: stored?.workspace ?? null });
  } catch (error) {
    console.error("Failed to load workspace:", error);
    return NextResponse.json(
      { error: "Failed to load workspace" },
      { status: 500 },
    );
  }
}

/**
 * Desktop and web both write this document. A save names the `savedAt` it
 * was edited from; when the stored copy has moved on since, the save is
 * refused with the current copy so the client can adopt it instead of
 * overwriting it.
 */
export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = workspaceSaveSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid workspace", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  const { baseSavedAt, ...workspace } = parsed.data;

  try {
    await connectDB();
    const savedAt = workspace.savedAt ?? new Date().toISOString();
    const data = { ...workspace, savedAt };

    if (baseSavedAt === undefined) {
      await DesktopWorkspace.updateOne(
        { _id: SINGLETON },
        { $set: { data } },
        { upsert: true },
      ).exec();
      return NextResponse.json({ savedAt });
    }

    const stored = await loadStored();
    const storedAt = stored?.savedAt ?? null;
    // A stored copy that no longer parses has nothing to protect.
    if (stored?.workspace && storedAt !== baseSavedAt) {
      return conflict(stored.workspace);
    }

    // The filter re-checks the stamp so a save landing in between still loses.
    const result = stored
      ? await DesktopWorkspace.updateOne(
          { _id: SINGLETON, "data.savedAt": storedAt },
          { $set: { data } },
        ).exec()
      : await DesktopWorkspace.updateOne(
          { _id: SINGLETON },
          { $setOnInsert: { data } },
          { upsert: true },
        ).exec();
    const written = stored ? result.matchedCount > 0 : result.upsertedCount > 0;
    if (!written) return conflict((await loadStored())?.workspace ?? null);
    return NextResponse.json({ savedAt });
  } catch (error) {
    console.error("Failed to save workspace:", error);
    return NextResponse.json(
      { error: "Failed to save workspace" },
      { status: 500 },
    );
  }
}

function conflict(workspace: Workspace | null) {
  return NextResponse.json(
    { error: "Workspace changed since this copy was loaded", workspace },
    { status: 409 },
  );
}
