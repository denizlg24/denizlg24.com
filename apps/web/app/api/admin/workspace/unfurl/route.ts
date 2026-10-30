import { workspaceUnfurlRequestSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  readBody,
  workspaceCaller,
  workspaceErrorResponse,
} from "@/lib/workspace/http";
import { WorkspaceError } from "@/lib/workspace/service";
import { UnfurlRefused, unfurl } from "@/lib/workspace/unfurl";

export const runtime = "nodejs";

/** `{ url }` → what a bookmark block shows for it. See `lib/workspace/unfurl.ts`. */
export async function POST(request: NextRequest) {
  await workspaceCaller(request);
  try {
    const { url } = await readBody(request, workspaceUnfurlRequestSchema);
    try {
      return NextResponse.json({ bookmark: await unfurl(url) });
    } catch (error) {
      if (error instanceof UnfurlRefused) {
        throw new WorkspaceError(422, "UNFURL_REFUSED", error.message);
      }
      throw new WorkspaceError(
        502,
        "UNFURL_FAILED",
        error instanceof Error ? error.message : "Could not fetch the URL",
      );
    }
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
