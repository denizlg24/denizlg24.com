"use client";

import {
  ContactsPage,
  ContactsSkeleton,
} from "@repo/admin/contacts/contacts-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function ContactsRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <ContactsSkeleton /> : <ContactsPage />}
    </AdminProvider>
  );
}
