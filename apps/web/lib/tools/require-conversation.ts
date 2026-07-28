import type { ToolExecutionContext } from "./types";

export function requireConversation(
  context: ToolExecutionContext | undefined,
  action: string,
): string {
  if (!context?.conversationId) {
    throw new Error(
      `${action} a sandbox file needs a saved conversation. Send a message first so the conversation is created.`,
    );
  }
  return context.conversationId;
}
