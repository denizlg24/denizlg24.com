import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { Inbox } from "lucide-react";
import Link from "next/link";

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

      <div className="h-full w-full grow border-t p-4 sm:p-6 lg:pl-70">
        <div className="space-y-3">
          <Skeleton className="h-8 w-40" />
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="flex items-center gap-3 rounded-md border p-3"
            >
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-full max-w-48" />
                <Skeleton className="h-3 w-full max-w-72" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
