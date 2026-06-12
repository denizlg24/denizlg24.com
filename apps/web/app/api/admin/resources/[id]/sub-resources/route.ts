import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { getUptimeData } from "@/lib/resource-agent";
import {
  parseSubResourceCheck,
  serializeSubResource,
} from "@/lib/sub-resource-payload";
import { getSubResourceModel } from "@/models/resource-db/SubResource";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid resource id" }, { status: 400 });
  }

  const SubResource = await getSubResourceModel();
  const subResources = await SubResource.find({ parentResourceId: id })
    .lean()
    .sort({ name: 1 });

  const uptimeMap = await getUptimeData(
    subResources.map((s) => s._id.toString()),
  );

  return NextResponse.json({
    subResources: subResources.map((s) => ({
      ...serializeSubResource(s),
      uptime: uptimeMap.get(s._id.toString()) ?? null,
    })),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ error: "Invalid resource id" }, { status: 400 });
  }

  const body = await request.json();
  if (!body.name || typeof body.name !== "string") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const check = parseSubResourceCheck(body.check);
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  const SubResource = await getSubResourceModel();
  const subResource = await SubResource.create({
    parentResourceId: id,
    name: body.name.trim(),
    description: typeof body.description === "string" ? body.description : "",
    isActive: body.isActive ?? true,
    isPublic: body.isPublic ?? true,
    check: check.value,
  });

  return NextResponse.json(
    { subResource: serializeSubResource(subResource.toObject()) },
    { status: 201 },
  );
}
