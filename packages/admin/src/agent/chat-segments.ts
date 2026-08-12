import type { IChatContentSegment, IChatToolCall } from "@repo/schemas";

/**
 * Merge incoming content segments into existing ones, deduplicating tool calls
 * by toolId (incoming wins on status/result). Used both for the live streaming
 * view and for persisting an assistant turn after an approval continuation, so
 * a replayed tool_call never renders twice and a stale "calling" copy can't
 * outlive its terminal event.
 */
export function mergeContentSegments(
  existing: IChatContentSegment[],
  incoming: IChatContentSegment[],
): IChatContentSegment[] {
  const merged: IChatContentSegment[] = existing.map((segment) =>
    segment.type === "tool_group"
      ? { ...segment, calls: segment.calls.map((call) => ({ ...call })) }
      : { ...segment },
  );

  const findExistingToolCall = (toolId: string): IChatToolCall | null => {
    for (const segment of merged) {
      if (segment.type !== "tool_group") continue;
      const call = segment.calls.find((item) => item.toolId === toolId);
      if (call) return call;
    }
    return null;
  };

  for (const segment of incoming) {
    if (segment.type === "text") {
      const last = merged[merged.length - 1];
      if (last?.type === "text") {
        last.text += segment.text;
      } else {
        merged.push({ ...segment });
      }
      continue;
    }

    let targetGroup:
      | Extract<IChatContentSegment, { type: "tool_group" }>
      | undefined;
    for (let index = merged.length - 1; index >= 0; index--) {
      const item = merged[index];
      if (item?.type === "tool_group") {
        targetGroup = item;
        break;
      }
    }
    for (const incomingCall of segment.calls) {
      const existingCall = findExistingToolCall(incomingCall.toolId);
      if (existingCall) {
        Object.assign(existingCall, incomingCall);
        continue;
      }

      if (!targetGroup || merged[merged.length - 1]?.type !== "tool_group") {
        targetGroup = { type: "tool_group", calls: [] };
        merged.push(targetGroup);
      }
      targetGroup.calls.push({ ...incomingCall });
    }
  }

  return merged;
}
