import { type NextRequest, NextResponse } from "next/server";
import { buildPiCronConfig } from "@/lib/capabilities/picron";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { Resource } from "@/models/Resource";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; capId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, capId } = await params;
  const body = await request.json();

  await connectDB();
  const resource = await Resource.findById(id);
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  const cap = resource.capabilities.id(capId);
  if (!cap) {
    return NextResponse.json(
      { error: "Capability not found" },
      { status: 404 },
    );
  }

  if (body.label !== undefined) cap.label = body.label;
  if (body.isActive !== undefined) cap.isActive = body.isActive;

  if (cap.type === "picron" && (body.username || body.password)) {
    const currentConfig = cap.config as Record<string, unknown>;
    const newConfig = buildPiCronConfig(
      body.username ?? "",
      body.password ?? "",
    );
    if (body.username) currentConfig.username = newConfig.username;
    if (body.password) currentConfig.password = newConfig.password;
    cap.config = currentConfig;
    resource.markModified("capabilities");
  } else if (body.config !== undefined) {
    cap.config = body.config;
    resource.markModified("capabilities");
  }

  await resource.save();

  return NextResponse.json({
    ...cap.toObject(),
    _id: cap._id.toString(),
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; capId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, capId } = await params;

  await connectDB();
  const resource = await Resource.findByIdAndUpdate(
    id,
    { $pull: { capabilities: { _id: capId } } },
    { new: true },
  );

  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  return NextResponse.json({ status: "deleted" });
}
