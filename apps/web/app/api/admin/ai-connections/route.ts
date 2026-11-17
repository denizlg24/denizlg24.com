import type { NextRequest } from "next/server";
import { getAiConnections } from "@/lib/ai-connections/gateway";
import {
  aiConnectionErrorResponse,
  authenticateAiConnectionRequest,
  privateJson,
} from "@/lib/ai-connections/http";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    await authenticateAiConnectionRequest(request);
    return privateJson(await getAiConnections());
  } catch (error) {
    return aiConnectionErrorResponse(error);
  }
}
