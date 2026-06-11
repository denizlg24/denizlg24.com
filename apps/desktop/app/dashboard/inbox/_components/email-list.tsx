"use client";

import { format, isToday, isYesterday } from "date-fns";
import { Loader2, Mail, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { denizApi } from "@/lib/api-wrapper";
import type { IEmail } from "@/lib/data-types";
import { cn } from "@/lib/utils";

function formatEmailDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMM d");
}

interface EmailsResponse {
  emails: IEmail[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface EmailListProps {
  accountId: string;
  accountName: string;
  api: denizApi;
  onSelectEmail: (email: IEmail) => void;
  selectedEmailId: string | null;
  refreshTrigger: number;
  emailListCache: React.RefObject<Map<string, IEmail[]>>;
}

const PAGE_SIZE = 50;
const REFETCH_INTERVAL = 60_000;

export function EmailList({
  accountId,
  accountName,
  api,
  onSelectEmail,
  selectedEmailId,
  refreshTrigger,
  emailListCache,
}: EmailListProps) {
  const cached = emailListCache.current.get(accountId);
  const [emails, setEmails] = useState<IEmail[]>(cached ?? []);
  const [loading, setLoading] = useState(!cached);
  const [syncing, setSyncing] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const fetchedRef = useRef<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchEmails = useCallback(
    async (pageNum: number, searchQuery: string, append: boolean) => {
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(PAGE_SIZE),
      });
      if (searchQuery) params.set("search", searchQuery);

      const result = await api.GET<EmailsResponse>({
        endpoint: `email-accounts/${accountId}/emails?${params}`,
      });

      if (!("code" in result)) {
        const newEmails = append
          ? [...emails, ...result.emails]
          : result.emails;
        if (!searchQuery) {
          emailListCache.current.set(accountId, newEmails);
        }
        setEmails(newEmails);
        setTotal(result.total);
        setPage(pageNum);
      }
      setLoading(false);
      setLoadingMore(false);
      setSearching(false);
    },
    [api, accountId, emailListCache, emails],
  );

  useEffect(() => {
    const hasCached = emailListCache.current.has(accountId);

    if (fetchedRef.current === accountId && refreshTrigger === 0) return;
    fetchedRef.current = accountId;
    setSearch("");
    setActiveSearch("");
    setPage(1);

    if (hasCached) {
      setEmails(emailListCache.current.get(accountId)!);
      setLoading(false);
      fetchEmails(1, "", false);
    } else {
      setLoading(true);
      fetchEmails(1, "", false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountId,
    refreshTrigger,
    emailListCache.current.get,
    emailListCache.current.has,
    fetchEmails,
  ]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (!activeSearch) fetchEmails(1, "", false);
    }, REFETCH_INTERVAL);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSearch, fetchEmails]);

  const handleLoadMore = () => {
    setLoadingMore(true);
    fetchEmails(page + 1, activeSearch, true);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);

    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);

    searchTimeoutRef.current = setTimeout(() => {
      setActiveSearch(value);
      setSearching(true);
      setPage(1);
      fetchEmails(1, value, false);
    }, 400);
  };

  const handleClearSearch = () => {
    setSearch("");
    setActiveSearch("");
    setPage(1);
    setSearching(true);
    fetchEmails(1, "", false);
  };

  const handleSync = async () => {
    setSyncing(true);
    const result = await api.POST<{ message: string }>({
      endpoint: `email-accounts/${accountId}/sync`,
      body: {},
    });

    if ("code" in result) {
      toast.error("Failed to sync");
    } else {
      toast.success("Sync complete");
      setPage(1);
      await fetchEmails(1, activeSearch, false);
    }
    setSyncing(false);
  };

  const unreadCount = emails.filter((e) => !e.seen).length;
  const hasMore = page * PAGE_SIZE < total;

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-3 border-b shrink-0">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">{accountName}</h2>
            {!loading && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {total} messages
                {unreadCount > 0 && `, ${unreadCount} unread`}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search emails..."
            className="h-8 pl-8 pr-8 text-xs"
          />
          {search && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : searching ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
            <Mail className="h-8 w-8 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {activeSearch ? "No results" : "No emails"}
              </p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                {activeSearch
                  ? "Try a different search term"
                  : "Sync to fetch new messages"}
              </p>
            </div>
            {!activeSearch && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleSync}
                disabled={syncing}
                className="mt-1"
              >
                {syncing ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Sync Now
              </Button>
            )}
          </div>
        ) : (
          <div>
            {emails.map((email) => {
              const isSelected = selectedEmailId === email._id;
              const senderName =
                email.from[0]?.name || email.from[0]?.address || "Unknown";

              return (
                <button
                  type="button"
                  key={email._id}
                  onClick={() => onSelectEmail(email)}
                  className={cn(
                    "w-full text-left px-5 py-3 border-b transition-colors",
                    isSelected ? "bg-accent/50" : "hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-start gap-3">
                    {!email.seen ? (
                      <div className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
                    ) : (
                      <div className="mt-1.5 h-2 w-2 shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-3">
                        <span
                          className={cn(
                            "text-sm truncate",
                            !email.seen ? "font-semibold" : "font-normal",
                          )}
                        >
                          {senderName}
                        </span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {formatEmailDate(email.date)}
                        </span>
                      </div>
                      <p
                        className={cn(
                          "text-sm truncate mt-0.5",
                          !email.seen
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        {email.subject || "(No Subject)"}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}

            {hasMore && (
              <div className="px-5 py-4 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="text-xs text-muted-foreground"
                >
                  {loadingMore ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : null}
                  {loadingMore
                    ? "Loading..."
                    : `Load more (${total - emails.length} remaining)`}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
