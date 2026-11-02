import { dataQuerySchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { queryData } from "@/lib/workspace/data";
import { readBody, withWorkspace } from "@/lib/workspace/http";

/** Documents of one allowlisted collection, secrets stripped. */
export async function POST(request: NextRequest) {
  return withWorkspace(request, async () => {
    const query = await readBody(request, dataQuerySchema);
    return NextResponse.json(await queryData(query));
  });
}
