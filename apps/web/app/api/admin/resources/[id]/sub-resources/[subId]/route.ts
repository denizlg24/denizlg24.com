import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import {
  parseSubResourceCheck,
  serializeSubResource,
} from "@/lib/sub-resource-payload";
import { getHealthCheckLogModel } from "@/models/resource-db/HealthCheckLog";
import { getSubResourceModel } from "@/models/resource-db/SubResource";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, subId } = await params;
  if (
    !mongoose.Types.ObjectId.isValid(id) ||
    !mongoose.Types.ObjectId.isValid(subId)
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await request.json();
  const update: Record<string, unknown> = {};

  if (typeof body.name === "string" && body.name.trim()) {
    update.name = body.name.trim();
  }
  if (typeof body.description === "string") {
    update.description = body.description;
  }
  if (typeof body.isActive === "boolean") update.isActive = body.isActive;
  if (typeof body.isPublic === "boolean") update.isPublic = body.isPublic;

  if (body.check !== undefined) {
    const check = parseSubResourceCheck(body.check);
    if ("error" in check) {
      return NextResponse.json({ error: check.error }, { status: 400 });
    }
    update.check = check.value;
  }

  const SubResource = await getSubResourceModel();
  const subResource = await SubResource.findOneAndUpdate(
    { _id: subId, parentResourceId: id },
    { $set: update },
    { new: true },
  ).lean();

  if (!subResource) {
    return NextResponse.json(
      { error: "Sub-resource not found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ subResource: serializeSubResource(subResource) });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id, subId } = await params;
  if (
    !mongoose.Types.ObjectId.isValid(id) ||
    !mongoose.Types.ObjectId.isValid(subId)
  ) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const SubResource = await getSubResourceModel();
  const subResource = await SubResource.findOneAndDelete({
    _id: subId,
    parentResourceId: id,
  });

  if (!subResource) {
    return NextResponse.json(
      { error: "Sub-resource not found" },
      { status: 404 },
    );
  }

  const HealthCheckLog = await getHealthCheckLogModel();
  await HealthCheckLog.deleteMany({ resourceId: subResource._id });

  return NextResponse.json({ status: "deleted" });
}
