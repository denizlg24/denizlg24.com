import "server-only";

import type { MacrosModerationEvent } from "@repo/schemas/macros";

import type { MacrosApi } from "@/lib/macros-api";

const CONTRIBUTOR_LOOKUP_LIMIT = 12;

/**
 * Events carry bare ids. Names and aliases come from the newest contributions
 * first (one query), then from each still-unknown contributor's own record, so
 * the log never has to print a user id.
 */
export async function resolveSubjectLabels(
  api: MacrosApi,
  events: readonly MacrosModerationEvent[],
  seed: ReadonlyMap<string, string> = new Map(),
): Promise<Map<string, string>> {
  const labels = new Map(seed);
  const missing = () => events.filter((event) => !labels.has(event.subjectId));
  if (missing().length === 0) return labels;

  const recent = await api.contributions({ status: "all", limit: 100 });
  if (recent.ok) {
    for (const item of recent.data.contributions) {
      if (!labels.has(item.itemId)) labels.set(item.itemId, item.name);
      if (!labels.has(item.contributor.id)) {
        labels.set(item.contributor.id, item.contributor.alias);
      }
    }
  }

  const contributors = [
    ...new Set(
      missing()
        .filter((event) => event.subjectType === "contributor")
        .map((event) => event.subjectId),
    ),
  ].slice(0, CONTRIBUTOR_LOOKUP_LIMIT);
  const details = await Promise.all(
    contributors.map((userId) => api.contributor(userId)),
  );
  for (const detail of details) {
    if (detail.ok) {
      labels.set(detail.data.contributor.id, detail.data.contributor.alias);
    }
  }
  return labels;
}
