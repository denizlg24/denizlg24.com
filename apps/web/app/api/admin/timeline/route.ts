import { type NextRequest, NextResponse } from "next/server";
import { revalidateTimelineContent } from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";
import { createTimelineItem, getAllTimelineItems } from "@/lib/timeline";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category") as
      | "work"
      | "education"
      | "personal"
      | null;

    const items = await getAllTimelineItems(category || undefined);

    return NextResponse.json({ items }, { status: 200 });
  } catch (error: unknown) {
    console.error("Error fetching timeline items:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch timeline items",
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    if (!body.title || !body.subtitle || !body.dateFrom || !body.category) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 },
      );
    }

    let order = 0;
    if (body.category) {
      const itemsInCategory = await getAllTimelineItems(body.category);
      if (itemsInCategory.length > 0) {
        const maxOrder = Math.max(
          ...itemsInCategory.map((item) => item.order || 0),
        );
        order = maxOrder + 1;
      }
    }

    const item = await createTimelineItem({
      title: body.title,
      subtitle: body.subtitle,
      logoUrl: body.logoUrl,
      dateFrom: body.dateFrom,
      dateTo: body.dateTo,
      topics: body.topics || [],
      category: body.category,
      order,
      links: body.links || [],
      isActive: body.isActive ?? true,
    });
    revalidateTimelineContent();
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    console.error("Error creating timeline item:", error);
    return NextResponse.json(
      {
        error: "Failed to create timeline item",
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
