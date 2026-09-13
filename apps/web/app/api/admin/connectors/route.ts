import { createConnectorInputSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { connectorErrorResponse } from "@/lib/connectors/http";
import { connectorOAuthRedirectUrl } from "@/lib/connectors/oauth-provider";
import {
  createConnector,
  listConnectors,
  serializeConnector,
} from "@/lib/connectors/service";
import { requireAdmin } from "@/lib/require-admin";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  try {
    const connectors = await listConnectors();
    return NextResponse.json({
      connectors: connectors.map(serializeConnector),
      oauthRedirectUrl: connectorOAuthRedirectUrl(),
    });
  } catch (error) {
    return connectorErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const parsed = createConnectorInputSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid connector", issues: parsed.error.issues.slice(0, 5) },
      { status: 400 },
    );
  }
  try {
    const connector = await createConnector(parsed.data);
    return NextResponse.json(
      { connector: serializeConnector(connector) },
      { status: 201 },
    );
  } catch (error) {
    return connectorErrorResponse(error);
  }
}
