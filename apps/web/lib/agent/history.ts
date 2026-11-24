import type { AgentUIMessage } from "@repo/schemas";
import {
  AgentMergeError,
  applyClientDecisions,
  hasPendingWork,
  sanitizeUserMessage,
  truncateForRegenerate,
} from "./merge";
import { messageText } from "./messages";

/**
 * The thread a chat turn runs on: the stored messages plus what the request
 * adds — a new user message, client decisions on the pending assistant
 * message, or a truncation for a regenerate.
 */
export function resolveHistory(
  stored: AgentUIMessage[],
  request: {
    trigger: "submit-message" | "regenerate-message";
    message?: AgentUIMessage;
    messageId?: string;
  },
): { history: AgentUIMessage[]; newUserText: string | null } {
  if (request.trigger === "regenerate-message") {
    if (!request.messageId) {
      throw new AgentMergeError("messageId is required to regenerate", 400);
    }
    const history = truncateForRegenerate(stored, request.messageId);
    const last = history.at(-1);
    return {
      history,
      newUserText: last?.role === "user" ? messageText(last) : null,
    };
  }
  if (!request.message) {
    throw new AgentMergeError("message is required", 400);
  }
  if (request.message.role === "assistant") {
    return {
      history: applyClientDecisions(stored, request.message),
      newUserText: null,
    };
  }
  // The same user message again is a retry of a turn that stored it and then
  // failed before replying, never a second copy of it.
  const last = stored.at(-1);
  if (last?.role === "user" && last.id === request.message.id) {
    return { history: [...stored], newUserText: messageText(last) };
  }
  // Anywhere else, the id means this message was already answered: a queue
  // head dispatched twice (two surfaces, or a stale queue copy) is refused.
  const messageId = request.message.id;
  if (stored.some((message) => message.id === messageId)) {
    throw new AgentMergeError("This message was already sent", 409);
  }
  if (hasPendingWork(stored)) {
    throw new AgentMergeError(
      "Resolve the pending tool call before sending a new message",
      409,
    );
  }
  const user = sanitizeUserMessage(request.message);
  return { history: [...stored, user], newUserText: messageText(user) };
}
