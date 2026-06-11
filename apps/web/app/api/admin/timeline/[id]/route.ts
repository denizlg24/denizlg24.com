import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { revalidateTimelineContent } from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";
import {
  deleteTimelineItem,
  toggleTimelineItemActive,
  updateTimelineItem,
} from "@/lib/timeline";
import type { ITimelineItem } from "@/models/TimelineItem";
import TimelineItem from "@/models/TimelineItem";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await connectDB();

    const item = await TimelineItem.findById(id);

    if (!item) {
      return NextResponse.json(
        { error: "Timeline item not found" },
        { status: 404 },
      );
    }

    return NextResponse.json({ item }, { status: 200 });
  } catch (error: unknown) {
    console.error("Error fetching timeline item:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch timeline item",
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();

    let item: ITimelineItem | null;

    if (body.toggleActive) {
      item = await toggleTimelineItemActive(id);
    } else {
      item = await updateTimelineItem(id, body);
    }

    if (!item) {
      return NextResponse.json(
        { error: "Timeline item not found" },
        { status: 404 },
      );
    }
    revalidateTimelineContent();
    return NextResponse.json({ item }, { status: 200 });
  } catch (error: unknown) {
    console.error("Error updating timeline item:", error);
    return NextResponse.json(
      {
        error: "Failed to update timeline item",
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;

    await deleteTimelineItem(id);
    revalidateTimelineContent();
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    console.error("Error deleting timeline item:", error);
    return NextResponse.json(
      {
        error: "Failed to delete timeline item",
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
