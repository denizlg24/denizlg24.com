import { Contact } from "lucide-react";
import type { Metadata } from "next";
import { getAllContacts, getContactCountByStatus } from "@/lib/contacts";
import { AdminPageHeader } from "../_components/admin-page-header";
import { ContactsWrapper } from "./contacts-wrapper";

export const metadata: Metadata = {
  title: "Contact Submissions | Admin Dashboard",
  description: "View and manage contact form submissions",
};

export default async function ContactsPage() {
  const [contacts, stats] = await Promise.all([
    getAllContacts({ limit: 100 }),
    getContactCountByStatus(),
  ]);

  return (
    <div className="flex flex-col gap-3">
      <AdminPageHeader
        icon={<Contact className="size-4 text-muted-foreground" />}
        title="Contact Submissions"
      />
      <ContactsWrapper
        initialContacts={contacts.map((contact) => ({
          ...contact,
          _id: contact._id.toString(),
        }))}
        initialStats={stats}
      />
    </div>
  );
}
