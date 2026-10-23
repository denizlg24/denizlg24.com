import { viewingInputSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";
import { fail, parseBody, requireProfile } from "@/lib/api";
import { saveViewing } from "@/lib/catalog";
import { invalidateRecommendations } from "@/lib/recommendations";
import { validViewing } from "@/lib/viewing";

export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/v1/profiles/[id]/viewing">,
) {
  const caller = await requireProfile(request, (await params).id);
  if (caller instanceof NextResponse) return caller;
  const input = await parseBody(request, viewingInputSchema);
  if (input instanceof NextResponse) return input;
  if (!(await validViewing(input)))
    return fail(404, "episode_or_title_not_found");
  const saved = await saveViewing(caller.profile.id, input);
  if (input.completed) await invalidateRecommendations(caller.profile.id);
  return NextResponse.json(saved);
}
