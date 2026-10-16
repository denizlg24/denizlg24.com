import {
  type IEmailTriage,
  TRIAGE_ATTENTION_ORDER,
  type TriageSuggestionType,
} from "@repo/schemas";

export interface PendingSuggestion {
  key: string;
  triageId: string;
  suggestionId: string;
  type: TriageSuggestionType;
  title: string;
  /** When it is due or happens, as the suggestion states it. */
  when?: string;
  detail?: string;
  subject: string;
  sender: string;
  category: IEmailTriage["category"];
  triagedAt: string;
}

function senderOf(triage: IEmailTriage) {
  const from = triage.email?.from[0];
  return from?.name || from?.address || "";
}

/**
 * One line per suggestion still waiting on a decision, most urgent category
 * first and newest first within it — the order a thumb works through them.
 */
export function pendingSuggestions(rows: IEmailTriage[]): PendingSuggestion[] {
  const out: PendingSuggestion[] = [];
  for (const triage of rows) {
    const base = {
      triageId: triage._id,
      subject: triage.email?.subject ?? "",
      sender: senderOf(triage),
      category: triage.category,
      triagedAt: triage.triagedAt,
    };
    for (const task of triage.suggestedTasks) {
      if (task.status !== "pending") continue;
      out.push({
        ...base,
        key: `${triage._id}:${task._id}`,
        suggestionId: task._id,
        type: "task",
        title: task.title,
        when: task.dueDate,
        detail: task.courseName ?? task.kanbanBoardTitle,
      });
    }
    for (const event of triage.suggestedEvents) {
      if (event.status !== "pending") continue;
      out.push({
        ...base,
        key: `${triage._id}:${event._id}`,
        suggestionId: event._id,
        type: "event",
        title: event.title,
        when: event.date,
        detail: event.place ?? event.courseName,
      });
    }
    for (const action of triage.suggestedActions) {
      if (action.status !== "pending") continue;
      out.push({
        ...base,
        key: `${triage._id}:${action._id}`,
        suggestionId: action._id,
        type: "action",
        title: action.summary,
        detail: action.tool,
      });
    }
  }
  const rank = (category: IEmailTriage["category"]) =>
    TRIAGE_ATTENTION_ORDER.indexOf(category);
  return out.sort(
    (a, b) =>
      rank(a.category) - rank(b.category) ||
      b.triagedAt.localeCompare(a.triagedAt),
  );
}
