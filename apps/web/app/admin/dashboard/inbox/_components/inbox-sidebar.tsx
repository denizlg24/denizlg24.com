"use client";

import { Inbox, Mail } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmailAccount {
  _id: string;
  user: string;
  host: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export const InboxSidebar = () => {
  const pathname = usePathname();

  const { data, isLoading } = useSWR("/api/admin/email-accounts", fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: true,
  });

  const accounts = data?.accounts || [];

  return (
    <div className="hidden lg:flex absolute left-0 h-full w-64 border-r bg-muted/30 flex-col">
      <nav className="flex flex-col gap-1 p-2 border-b">
        <Button
          variant={
            pathname === "/admin/dashboard/inbox" ? "secondary" : "ghost"
          }
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

      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 px-2 py-1">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Accounts
          </h3>
        </div>

        {isLoading ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground animate-pulse">
            Loading accounts...
          </div>
        ) : accounts.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            No accounts added yet
          </div>
        ) : (
          <div className="space-y-1">
            {accounts.map((account: EmailAccount) => {
              const isActive =
                pathname === `/admin/dashboard/inbox/account/${account._id}`;
              return (
                <Button
                  key={account._id}
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  asChild
                  className={cn(
                    "w-full justify-start gap-2 h-auto py-2 px-2",
                    isActive && "bg-secondary",
                  )}
                >
                  <Link href={`/admin/dashboard/inbox/account/${account._id}`}>
                    <Mail className="w-4 h-4 shrink-0" />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm font-medium truncate">
                        {account.user.split("@")[0]}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        {account.user}
                      </div>
                    </div>
                  </Link>
                </Button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
