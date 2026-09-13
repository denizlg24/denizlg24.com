import { updateConnectorInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { connectorErrorResponse } from "@/lib/connectors/http";
import {
  cachedToolDefinitions,
  deleteConnector,
  describeToolDefinition,
  getConnector,
  serializeConnector,
  updateConnector,
} from "@/lib/connectors/service";
import { requireAdmin } from "@/lib/require-admin";

type Params = { params: Promise<{ connectorId: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const connector = await getConnector((await params).connectorId);
    return NextResponse.json({
      connector: serializeConnector(connector),
      tools: cachedToolDefinitions(connector).map(describeToolDefinition),
    });
  } catch (error) {
    return connectorErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = updateConnectorInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid update", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  try {
    const connector = await updateConnector(
      (await params).connectorId,
      parsed.data,
    );
    return NextResponse.json({
      connector: serializeConnector(connector),
      tools: cachedToolDefinitions(connector).map(describeToolDefinition),
    });
  } catch (error) {
    return connectorErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    await deleteConnector((await params).connectorId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return connectorErrorResponse(error);
  }
}
