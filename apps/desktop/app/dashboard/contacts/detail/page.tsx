"use client";

import { ContactDetailPage } from "@repo/admin/contacts/contact-detail-page";
import { AdminRecordRoute } from "@/components/admin-route";

export default function ContactDetailRoute() {
  return (
    <AdminRecordRoute redirectTo="/dashboard/contacts">
      {(id) => <ContactDetailPage ticketId={id} />}
    </AdminRecordRoute>
  );
}
