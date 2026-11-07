import type { DashboardNotificationKind } from "@repo/schemas";
import { scheduleDashboardPush } from "@/lib/mobile-push";

type SprintPushKind = Extract<
  DashboardNotificationKind,
  | "sprint_run_started"
  | "sprint_run_finished"
  | "sprint_run_failed"
  | "sprint_release_ready"
>;

/**
 * Lock-screen text is the sprint and slot title, nothing a run produced. No
 * `url`: the dashboard app routes only `dashboard://` links and has no
 * sprint screen, so a PR link would be dropped on tap.
 */
export function pushSprint(
  kind: SprintPushKind,
  push: { sprintTitle: string; slotTitle: string; subject: string },
) {
  scheduleDashboardPush({
    kind,
    title: push.sprintTitle,
    body: push.slotTitle,
    subject: push.subject,
  });
}
