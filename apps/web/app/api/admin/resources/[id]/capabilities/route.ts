import { type NextRequest, NextResponse } from "next/server";
import { buildPiCronConfig } from "@/lib/capabilities/picron";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { Resource } from "@/models/Resource";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  await connectDB();
  const resource = await Resource.findById(id).lean();
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }
  return NextResponse.json({
    resource: resource.name,
    capabilities: resource.capabilities.map((cap) => ({
      _id: cap._id.toString(),
      type: cap.type,
      label: cap.label,
      baseUrl: cap.baseUrl,
      isActive: cap.isActive,
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
  const body = await request.json();
  const { type, label, baseUrl, isActive, ...rest } = body;

  if (!type || !label || !baseUrl) {
    return NextResponse.json(
      { error: "type, label, and baseUrl are required" },
      { status: 400 },
    );
  }

  let config: Record<string, unknown>;

  if (type === "picron") {
    const { username, password } = rest;
    if (!username || !password) {
      return NextResponse.json(
        { error: "username and password are required for picron capabilities" },
        { status: 400 },
      );
    }
    config = buildPiCronConfig(username, password);
  } else {
    config = rest.config ?? {};
  }

  await connectDB();
  const resource = await Resource.findByIdAndUpdate(
    id,
    {
      $push: {
        capabilities: {
          type,
          label,
          baseUrl,
          config,
          isActive: isActive ?? true,
        },
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  const added = resource.capabilities[resource.capabilities.length - 1];

  return NextResponse.json(
    { ...added, _id: added._id.toString() },
    { status: 201 },
  );
}
