import { type NextRequest, NextResponse } from "next/server";
import { getNowPageContent, upsertNowPageContent } from "@/lib/now-page";
import { revalidateNowContent } from "@/lib/public-content-revalidation";
import { requireAdmin } from "@/lib/require-admin";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const doc = await getNowPageContent();

    return NextResponse.json(
      { item: doc || { content: "", updatedAt: null } },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("Error fetching now page content:", error);
    return NextResponse.json(
      {
        error: "Failed to fetch now page content",
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();

    if (typeof body.content !== "string") {
      return NextResponse.json(
        { error: "Content is required and must be a string" },
        { status: 400 },
      );
    }

    const item = await upsertNowPageContent(body.content);

    revalidateNowContent();

    return NextResponse.json({ item }, { status: 200 });
  } catch (error: unknown) {
    console.error("Error updating now page content:", error);
    return NextResponse.json(
      {
        error: "Failed to update now page content",
        details: getErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
