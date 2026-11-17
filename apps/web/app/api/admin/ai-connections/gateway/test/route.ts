import type { NextRequest } from "next/server";
import { testGatewayConnection } from "@/lib/ai-connections/gateway";
import {
  aiConnectionErrorResponse,
  authenticateAiConnectionRequest,
  privateJson,
} from "@/lib/ai-connections/http";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    await authenticateAiConnectionRequest(request, true);
    return privateJson(await testGatewayConnection());
  } catch (error) {
    return aiConnectionErrorResponse(error);
  }
}
