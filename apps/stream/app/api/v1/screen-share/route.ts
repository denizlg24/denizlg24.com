import { NextResponse } from "next/server";
import { requireMember } from "@/lib/api";
import { createScreenShare } from "@/lib/screen-share";

export async function POST(request: Request) {
  const caller = await requireMember(request);
  if (caller instanceof NextResponse) return caller;
  return Response.json(await createScreenShare());
}
