import { type NextRequest, NextResponse } from "next/server";
import {
  appOrigin,
  cookieOptions,
  json,
  sameOrigin,
  sessionCookie,
} from "@/lib/auth";
import { deleteSession } from "@/lib/db";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return json({ error: "Origin not allowed" }, 403);
  const origin = appOrigin(request);
  const token = request.cookies.get(sessionCookie(origin))?.value;
  if (token) await deleteSession(token);
  const response = NextResponse.redirect(new URL("/", origin), 303);
  response.cookies.set(sessionCookie(origin), "", cookieOptions(origin, 0));
  return response;
}
