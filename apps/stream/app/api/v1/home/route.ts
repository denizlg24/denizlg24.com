import { NextResponse } from "next/server";

import { profileParam, requireProfile } from "@/lib/api";
import { buildHome } from "@/lib/home";

export async function GET(request: Request) {
  const caller = await requireProfile(request, profileParam(request));
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json(await buildHome(caller.profile));
}
