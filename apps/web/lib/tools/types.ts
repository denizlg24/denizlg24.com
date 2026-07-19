export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
}

export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, ToolParameter | Record<string, unknown>>;
    required?: string[];
  };
}

export interface ToolDefinition {
  schema: ToolSchema;
  isWrite: boolean;
  category: string;
  runtime?: "server" | "client";
  execute?: (input: Record<string, unknown>) => Promise<unknown>;
}

/** Returned from execute() to attach an image block to the tool result.
 *  The summary is what streams to the client UI and accompanies the image
 *  as text for the model. */
export interface ToolImageResult {
  kind: "tool-image";
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  base64: string;
  summary: Record<string, unknown>;
}

export function isToolImageResult(value: unknown): value is ToolImageResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    value.kind === "tool-image" &&
    "base64" in value &&
    typeof value.base64 === "string" &&
    "mediaType" in value &&
    typeof value.mediaType === "string"
  );
}
