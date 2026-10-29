import type { IContact } from "@repo/schemas";

export type ContactStatus = IContact["status"];

export const CONTACT_STATUS_BADGE: Record<
  ContactStatus,
  { label: string; variant: "warning" | "info" | "good" | "outline" }
> = {
  pending: { label: "Pending", variant: "warning" },
  read: { label: "Read", variant: "info" },
  responded: { label: "Responded", variant: "good" },
  archived: { label: "Archived", variant: "outline" },
};
