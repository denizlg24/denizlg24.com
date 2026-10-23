import { progressInputSchema } from "@repo/schemas/stream";
import { NextResponse } from "next/server";

import { fail, parseBody, requireProfile } from "@/lib/api";
import { findTitle, saveProgress } from "@/lib/catalog";
import { invalidateRecommendations } from "@/lib/recommendations";

export async function PUT(
  request: Request,
  { params }: RouteContext<"/api/v1/profiles/[id]/progress">,
) {
  const { id } = await params;
  const caller = await requireProfile(request, id);
  if (caller instanceof NextResponse) return caller;
  const input = await parseBody(request, progressInputSchema);
  if (input instanceof NextResponse) return input;
  if (!(await findTitle(input.titleId))) return fail(404, "title_not_found");
  const saved = await saveProgress(caller.profile.id, input);
  if (saved.completed) await invalidateRecommendations(caller.profile.id);
  return NextResponse.json(saved);
}
