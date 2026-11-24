import {
  MCP_SURFACE_META_KEY,
  MCP_TOOL_PROFILE_HEADER,
  type McpToolProfile,
} from "@repo/schemas";
import { createClient, recordingUpstream } from "./harness.test-util";

export type ListedTool = Awaited<
  ReturnType<ReturnType<typeof createClient>["listTools"]>
>[number];

export interface SurfaceSize {
  tools: number;
  /** `tools/list` as served. */
  listBytes: number;
  /** What a model is handed per request: name, description, input schema. */
  modelBytes: number;
  /** modelBytes / 4, the usual rough ratio for JSON. */
  approxTokens: number;
}

export function modelBytes(tools: readonly ListedTool[]): number {
  return tools.reduce(
    (total, tool) =>
      total +
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema,
      }).length,
    0,
  );
}

export function sizeOf(tools: readonly ListedTool[]): SurfaceSize {
  const bytes = modelBytes(tools);
  return {
    tools: tools.length,
    listBytes: JSON.stringify(tools).length,
    modelBytes: bytes,
    approxTokens: Math.round(bytes / 4),
  };
}

export async function listProfile(
  profile: McpToolProfile,
): Promise<ListedTool[]> {
  const { upstream } = recordingUpstream();
  return createClient(upstream, undefined, {
    headers: { [MCP_TOOL_PROFILE_HEADER]: profile },
  }).listTools();
}

/** What web hands its model: the compact surface filtered out of the full list. */
export function compactOf(tools: readonly ListedTool[]): ListedTool[] {
  return tools.filter(
    (tool) => tool._meta?.[MCP_SURFACE_META_KEY] === "compact",
  );
}
