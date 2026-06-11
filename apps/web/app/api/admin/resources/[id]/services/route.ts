import { type NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import { getServicesList, restartService } from "@/lib/resource-agent";
import { Resource } from "@/models/Resource";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  await connectDB();
  const resource = await Resource.findById(id);
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  const result = await getServicesList(resource);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ services: result.services });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json();
  const { serviceName } = body;

  if (!serviceName) {
    return NextResponse.json(
      { error: "serviceName is required" },
      { status: 400 },
    );
  }

  await connectDB();
  const resource = await Resource.findById(id);
  if (!resource) {
    return NextResponse.json({ error: "Resource not found" }, { status: 404 });
  }

  const result = await restartService(resource, serviceName);
  if (!result.success) {
    return NextResponse.json(
      { error: result.error },
      { status: result.error?.includes("not monitored") ? 403 : 502 },
    );
  }

  return NextResponse.json({
    status: "restarting",
    serviceName,
    message: result.message,
  });
}
