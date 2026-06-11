"use client";

import { ChevronDown, Inbox, Mail } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import useSWR from "swr";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface EmailAccount {
  _id: string;
  user: string;
  host: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export const InboxMobileDropdown = () => {
  const pathname = usePathname();
  const router = useRouter();

  const { data, isLoading } = useSWR("/api/admin/email-accounts", fetcher, {
    refreshInterval: 60000,
    revalidateOnFocus: true,
  });

  const accounts = data?.accounts || [];

  const getCurrentLabel = () => {
    if (pathname === "/admin/dashboard/inbox") {
      return "All Accounts";
    }

    const accountMatch = pathname.match(/\/account\/([^/]+)/);
    if (accountMatch) {
      const accountId = accountMatch[1];
      const account = accounts.find((a: EmailAccount) => a._id === accountId);
      if (account) {
        return account.user;
      }
    }

    return "Select Inbox";
  };

  if (isLoading) {
    return (
      <Button
        variant="outline"
        className="w-full max-w-62.5 justify-between text-sm sm:text-base animate-pulse"
        disabled
      >
        <span className="text-muted-foreground">Loading...</span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="w-full max-w-62.5 justify-between text-sm sm:text-base"
        >
          <span className="truncate">{getCurrentLabel()}</span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-62.5">
        <DropdownMenuLabel className="text-xs sm:text-sm">
          Navigation
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => router.push("/admin/dashboard/inbox")}
          className="cursor-pointer text-sm"
        >
          <Inbox className="mr-2 h-4 w-4" />
          All Accounts
        </DropdownMenuItem>

        {accounts.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs sm:text-sm">
              Accounts
            </DropdownMenuLabel>
            {accounts.map((account: EmailAccount) => (
              <DropdownMenuItem
                key={account._id}
                onClick={() =>
                  router.push(`/admin/dashboard/inbox/account/${account._id}`)
                }
                className="cursor-pointer"
              >
                <Mail className="mr-2 h-4 w-4 shrink-0" />
                <div className="flex flex-col min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {account.user.split("@")[0]}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {account.user}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
