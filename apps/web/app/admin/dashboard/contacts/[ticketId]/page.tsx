import { ContactDetailPage } from "@repo/admin/contacts/contact-detail-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Contact | Admin Dashboard",
};

export default async function ContactDetailRoute({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return (
    <AdminFeatureShell>
      <ContactDetailPage ticketId={ticketId} />
    </AdminFeatureShell>
  );
}
