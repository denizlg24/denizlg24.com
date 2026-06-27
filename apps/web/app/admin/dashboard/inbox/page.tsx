import { InboxPage } from "@repo/admin/inbox/inbox-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Inbox | Admin Dashboard",
  description: "Read and manage email",
};

export default function InboxRoute() {
  return (
    <AdminFeatureShell>
      <InboxPage />
    </AdminFeatureShell>
  );
}
