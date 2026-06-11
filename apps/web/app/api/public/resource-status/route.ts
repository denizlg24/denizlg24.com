import { NextResponse } from "next/server";
import { getPublicResourceStatuses } from "@/lib/resource-agent";

export const revalidate = 60;

export async function GET() {
  try {
    const statuses = await getPublicResourceStatuses();
    return NextResponse.json({ statuses });
  } catch (err) {
    console.error("public resource status failed", err);
    return NextResponse.json({ statuses: [] }, { status: 200 });
  }
}
