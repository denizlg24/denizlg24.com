import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import ApiKey from "@/models/ApiKey";

export const POST = async (request: NextRequest) => {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const { name } = await request.json();
    const rawKey = `dlg24_${crypto.randomBytes(32).toString("hex")}`;
    const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
    await connectDB();
    const apiKey = new ApiKey({
      name,
      key: hashedKey,
    });
    await apiKey.save();
    return NextResponse.json(
      { apiKey: rawKey },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error("Error creating API key:", error);
    return NextResponse.json(
      { error: "Failed to create API key" },
      { status: 500 },
    );
  }
};
