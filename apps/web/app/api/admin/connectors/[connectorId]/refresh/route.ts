import { type NextRequest, NextResponse } from "next/server";
import { connectorErrorResponse } from "@/lib/connectors/http";
import {
  cachedToolDefinitions,
  describeToolDefinition,
  getConnector,
  refreshConnectorTools,
  serializeConnector,
} from "@/lib/connectors/service";
import { requireAdmin } from "@/lib/require-admin";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectorId: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const connector = await refreshConnectorTools(
      await getConnector((await params).connectorId),
    );
    return NextResponse.json({
      connector: serializeConnector(connector),
      tools: cachedToolDefinitions(connector).map(describeToolDefinition),
    });
  } catch (error) {
    return connectorErrorResponse(error);
  }
}
