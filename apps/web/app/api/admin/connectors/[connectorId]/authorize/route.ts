import { type NextRequest, NextResponse } from "next/server";
import { connectorErrorResponse } from "@/lib/connectors/http";
import {
  disconnectConnectorAuthorization,
  serializeConnector,
  startConnectorAuthorization,
} from "@/lib/connectors/service";
import { requireAdmin } from "@/lib/require-admin";

type Params = { params: Promise<{ connectorId: string }> };

/** Starts (or completes, when tokens are already valid) MCP authorization. */
export async function POST(request: NextRequest, { params }: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const result = await startConnectorAuthorization(
      (await params).connectorId,
    );
    return NextResponse.json(result);
  } catch (error) {
    return connectorErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const connector = await disconnectConnectorAuthorization(
      (await params).connectorId,
    );
    return NextResponse.json({ connector: serializeConnector(connector) });
  } catch (error) {
    return connectorErrorResponse(error);
  }
}
