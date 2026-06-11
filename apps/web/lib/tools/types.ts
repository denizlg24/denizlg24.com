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
