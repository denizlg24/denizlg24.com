import crypto from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import ApiKey from "@/models/ApiKey";

export const PUT = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid API key ID" }, { status: 400 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    await connectDB();
    const rawKey = `dlg24_${crypto.randomBytes(32).toString("hex")}`;
    const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
    const apiKey = await ApiKey.findByIdAndUpdate(
      id,
      { key: hashedKey },
      { new: true },
    );
    if (!apiKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }
    return NextResponse.json(
      { apiKey: rawKey },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error updating API key:", error);
    return NextResponse.json(
      { error: "Failed to update API key" },
      { status: 500 },
    );
  }
};

export const DELETE = async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  const { id } = await params;
  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "Invalid API key ID" }, { status: 400 });
  }
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    await connectDB();
    const apiKey = await ApiKey.findByIdAndDelete(id);
    if (!apiKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }
    return NextResponse.json(
      { message: "API key deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error deleting API key:", error);
    return NextResponse.json(
      { error: "Failed to delete API key" },
      { status: 500 },
    );
  }
};
