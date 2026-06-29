import { ContactsPage } from "@repo/admin/contacts/contacts-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Contact Submissions | Admin Dashboard",
  description: "View and manage contact form submissions",
};

export default function ContactsRoute() {
  return (
    <AdminFeatureShell>
      <ContactsPage />
    </AdminFeatureShell>
  );
}
