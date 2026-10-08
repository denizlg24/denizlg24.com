import {
  type MacrosFoodReportReason,
  macrosFoodReportReasonLabels,
} from "@repo/schemas/macros";

import { sendEmail } from "@/lib/email";

const consoleUrl =
  process.env.MACROS_ADMIN_URL ?? "https://macros-admin.denizlg24.com";

/**
 * Mails the moderator when a food gets its first open report, or when reports
 * hid it. Carries no reporter or contributor identity: the console has that.
 * Unset `MACROS_MODERATION_EMAIL` sends nothing.
 */
export async function notifyNewReport(input: {
  itemId: string;
  reason: MacrosFoodReportReason;
  openReports: number;
  hidden: boolean;
}) {
  const to = process.env.MACROS_MODERATION_EMAIL;
  if (!to) return;

  const link = `${consoleUrl}/reports/${input.itemId}`;
  const reason = macrosFoodReportReasonLabels[input.reason];
  const subject = input.hidden
    ? "A shared food was hidden after reports"
    : `A shared food was reported: ${reason}`;
  const lines = [
    input.hidden
      ? `${input.openReports} open reports hid this food from search. It stays hidden until you review it.`
      : `Reason: ${reason}.`,
    `Review: ${link}`,
  ];

  await sendEmail({
    to,
    subject,
    text: lines.join("\n\n"),
    html: lines
      .map((line) =>
        line.startsWith("Review: ")
          ? `<p><a href="${link}">Open the report</a></p>`
          : `<p>${line}</p>`,
      )
      .join(""),
  });
}
