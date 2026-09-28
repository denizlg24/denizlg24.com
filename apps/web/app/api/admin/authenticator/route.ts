import { type NextRequest, NextResponse } from "next/server";
import { createAccount, getAllAccounts } from "@/lib/authenticator";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const accounts = await getAllAccounts();
    return NextResponse.json({ accounts }, { status: 200 });
  } catch (error) {
    console.error("Error fetching authenticator accounts:", error);
    return NextResponse.json(
      { error: "Failed to fetch accounts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { label, issuer, accountName, secret, algorithm, digits, period } =
      body;

    if (
      typeof label !== "string" ||
      typeof secret !== "string" ||
      !label.trim() ||
      !secret.trim()
    ) {
      return NextResponse.json(
        { error: "label and secret are required" },
        { status: 400 },
      );
    }

    const account = await createAccount({
      label,
      issuer: issuer ?? "",
      accountName: accountName ?? "",
      secret,
      algorithm,
      digits,
      period,
    });

    return NextResponse.json(
      { message: "Account created", account },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating authenticator account:", error);
    if (error instanceof Error) {
      if (error.message.startsWith("IMAP_ENCRYPTION_KEY")) {
        return NextResponse.json(
          {
            error:
              "Authenticator encryption is not configured. Set IMAP_ENCRYPTION_KEY to a 64-character hex key.",
          },
          { status: 503 },
        );
      }
      if (
        /^(Account label|Secret must|Unsupported TOTP|TOTP code|TOTP period|Invalid character)/.test(
          error.message,
        )
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 },
    );
  }
}
