import { Inbox } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function InboxLoading() {
  return (
    <main className="w-full flex flex-col items-center relative min-h-screen animate-in fade-in duration-300">
      <div className="hidden lg:block absolute left-0 h-full w-64 border-r bg-muted/30">
        <nav className="flex flex-col gap-1 p-2 border-b">
          <Button
            variant={"secondary"}
            size="sm"
            asChild
            className="justify-start gap-2"
          >
            <Link href="/admin/dashboard/inbox">
              <Inbox className="w-4 h-4" />
              <span className="text-sm">All Accounts</span>
            </Link>
          </Button>
        </nav>
      </div>

      <div className="border-t grow w-full lg:pl-64 h-full p-4 sm:p-6"></div>
    </main>
  );
}
