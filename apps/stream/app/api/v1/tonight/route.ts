import { NextResponse } from "next/server";

import { requireAudience } from "@/lib/api";
import { buildTonight } from "@/lib/tonight";

export async function GET(request: Request) {
  const caller = await requireAudience(request);
  if (caller instanceof NextResponse) return caller;
  return NextResponse.json(await buildTonight(caller.profiles));
}
