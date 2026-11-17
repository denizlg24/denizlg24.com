import { gatewayConnectionInputSchema } from "@repo/schemas";
import type { NextRequest } from "next/server";
import { AiConnectionError } from "@/lib/ai-connections/errors";
import {
  configureGateway,
  getAiConnections,
} from "@/lib/ai-connections/gateway";
import {
  aiConnectionErrorResponse,
  authenticateAiConnectionRequest,
  privateJson,
} from "@/lib/ai-connections/http";
import { disconnectGateway } from "@/lib/ai-connections/store";

export const runtime = "nodejs";
export async function PUT(request: NextRequest) {
  try {
    await authenticateAiConnectionRequest(request, true);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AiConnectionError("input", "Invalid Gateway connection input.");
    }
    const parsed = gatewayConnectionInputSchema.safeParse(body);
    if (!parsed.success)
      throw new AiConnectionError("input", "Invalid Gateway connection input.");
    await configureGateway(parsed.data);
    return privateJson(await getAiConnections());
  } catch (error) {
    return aiConnectionErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await authenticateAiConnectionRequest(request, true);
    await disconnectGateway();
    return privateJson(await getAiConnections());
  } catch (error) {
    return aiConnectionErrorResponse(error);
  }
}
