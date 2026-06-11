import { Inbox } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function AccountInboxLoading() {
  return (
    <main className="w-full flex flex-col items-center relative min-h-screen animate-in fade-in duration-300">
      <div className="hidden lg:block absolute left-0 h-full w-64 border-r bg-muted/30">
        <nav className="flex flex-col gap-1 p-2 border-b">
          <Button
            variant={"ghost"}
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

      <div className="border-t grow w-full lg:pl-64 h-full overflow-auto">
        <div className="border-b p-3 sm:p-4 flex items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold">Inbox</h1>
        </div>
        <div className="flex-1 flex items-center justify-center py-12 text-sm text-muted-foreground animate-pulse">
          Loading emails...
        </div>
      </div>
    </main>
  );
}
