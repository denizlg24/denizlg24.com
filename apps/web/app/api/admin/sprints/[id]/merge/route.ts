import { type NextRequest, NextResponse } from "next/server";
import { withSprints } from "@/lib/sprints/http";
import { requestMerge } from "@/lib/sprints/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withSprints(request, async () => {
    const { id } = await params;
    return NextResponse.json({ sprint: await requestMerge(id) });
  });
}
