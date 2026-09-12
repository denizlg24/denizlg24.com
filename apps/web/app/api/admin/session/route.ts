import { type NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/lib/require-admin";

/** Whether the caller is the admin, and through which credential. */
export async function GET(request: NextRequest) {
  const session = await getAdminSession(request);
  if (!session) {
    return NextResponse.json(
      { admin: false },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { admin: true, via: session.via },
    { headers: { "Cache-Control": "no-store" } },
  );
}
