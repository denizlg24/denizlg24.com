import { forbidden } from "next/navigation";
import { getAdminSession } from "@/lib/require-admin";
import { InboxMobileDropdown } from "../../_components/inbox-mobile-dropdown";
import { InboxSidebar } from "../../_components/inbox-sidebar";
import { EmailList } from "./_components/email-list";

export default async function AccountInboxPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getAdminSession();

  if (!session) {
    forbidden();
  }

  const { id } = await params;

  return (
    <main className="w-full flex flex-col items-center relative min-h-screen animate-in fade-in duration-300 overflow-x-hidden">
      <InboxSidebar />
      <div className="border-t grow w-full lg:pl-64 h-full max-h-screen overflow-x-hidden">
        <div className="lg:hidden p-4 border-b">
          <InboxMobileDropdown />
        </div>
        <div className="w-full h-full overflow-x-hidden">
          <EmailList accountId={id} />
        </div>
      </div>
    </main>
  );
}
