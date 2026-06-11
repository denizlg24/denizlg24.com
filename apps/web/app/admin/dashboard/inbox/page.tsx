import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { AccountsList } from "./_components/accounts-list";
import { InboxMobileDropdown } from "./_components/inbox-mobile-dropdown";
import { InboxSidebar } from "./_components/inbox-sidebar";

export const metadata = {
  title: "Email Inbox - Admin Dashboard",
  description: "Manage your email accounts and inbox",
};

export default async function Page() {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  return (
    <main className="w-full flex flex-col items-center relative min-h-screen animate-in fade-in duration-300">
      <InboxSidebar />
      <div className="border-t grow w-full lg:pl-64 h-full max-h-screen overflow-x-hidden overflow-y-auto p-4 sm:p-6">
        <div className="lg:hidden mb-4">
          <InboxMobileDropdown />
        </div>
        <AccountsList />
      </div>
    </main>
  );
}
