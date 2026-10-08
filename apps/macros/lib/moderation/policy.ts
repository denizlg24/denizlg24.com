import type { MacrosFoodReportReason } from "@repo/schemas/macros";

/**
 * Reasons that, from enough different people, take a food out of search before
 * anyone reviews it. "Wrong nutrition" never does: it is a correction, not
 * harm, and one disagreement should not hide a food from everyone.
 */
export const AUTO_HIDE_REASONS: ReadonlySet<MacrosFoodReportReason> = new Set([
  "offensive",
  "spam",
  "personal_info",
]);

export const AUTO_HIDE_THRESHOLD = 3;

export const AUTO_HIDE_ACTOR = "auto";

/** Also how a hold is recognised on a food nobody is known to have added. */
export const AUTO_HIDE_REASON = `Hidden after ${AUTO_HIDE_THRESHOLD} reports, awaiting review`;

export function shouldAutoHide(
  openReports: readonly { reason: MacrosFoodReportReason }[],
): boolean {
  return (
    openReports.filter((report) => AUTO_HIDE_REASONS.has(report.reason))
      .length >= AUTO_HIDE_THRESHOLD
  );
}
