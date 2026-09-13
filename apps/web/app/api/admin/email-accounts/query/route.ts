import { emailQuerySchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import {
  EmailAccountNotFoundError,
  queryEmailAccounts,
} from "@/lib/email-query";
import { requireAdmin } from "@/lib/require-admin";

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const parsed = emailQuerySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid email query", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await queryEmailAccounts(parsed.data));
  } catch (error) {
    if (error instanceof EmailAccountNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error("Email query failed:", error);
    return NextResponse.json({ error: "Email query failed" }, { status: 500 });
  }
}
