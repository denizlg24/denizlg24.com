import { type NextRequest, NextResponse } from "next/server";
import {
  appOrigin,
  cookieOptions,
  json,
  sameOrigin,
  sessionCookie,
} from "@/lib/auth";
import { renewSession, sessionAge } from "@/lib/db";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const origin = appOrigin(request);
  const name = sessionCookie(origin);
  const token = request.cookies.get(name)?.value;
  const response = new NextResponse(null, { status: 204 });
  if (token && (await renewSession(token)))
    response.cookies.set(name, token, cookieOptions(origin, sessionAge));
  return response;
}
