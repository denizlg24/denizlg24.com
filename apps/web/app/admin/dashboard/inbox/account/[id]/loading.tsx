import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { Inbox } from "lucide-react";
import Link from "next/link";

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
        <div className="flex flex-col">
          {[1, 2, 3, 4, 5].map((item) => (
            <div key={item} className="flex items-center gap-3 border-b p-4">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-full max-w-52" />
                <Skeleton className="h-3 w-full max-w-md" />
              </div>
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
