"use client";

import type { EmailListResponse, IEmail } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { SplitList } from "@repo/ui/split-view";
import { SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { format, isThisYear, isToday, isYesterday } from "date-fns";
import { Mail, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdmin } from "../provider";

export function formatEmailDate(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Yesterday";
  if (isThisYear(date)) return format(date, "MMM d");
  return format(date, "MMM d, yyyy");
}

export function senderLabel(email: Pick<IEmail, "from">): string {
  return email.from[0]?.name || email.from[0]?.address || "Unknown";
}

interface EmailListProps {
  accountId: string;
  onSelectEmail: (email: IEmail) => void;
  selectedEmailId: string | null;
  emailListCache: React.RefObject<Map<string, IEmail[]>>;
  syncing: boolean;
  onSync: () => void;
}

const PAGE_SIZE = 50;
const REFETCH_INTERVAL = 60_000;
const SEARCH_DEBOUNCE_MS = 400;

export function EmailListSkeleton() {
  return (
    <div className="flex flex-col gap-1">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 py-1.5">
          <span className="size-5 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn("h-3", index % 2 ? "w-28" : "w-36")} />
            <Skeleton className={cn("h-2.5", index % 3 ? "w-48" : "w-40")} />
          </div>
          <Skeleton className="h-2.5 w-9" />
        </div>
      ))}
    </div>
  );
}

export function EmailList({
  accountId,
  onSelectEmail,
  selectedEmailId,
  emailListCache,
  syncing,
  onSync,
}: EmailListProps) {
  const { client } = useAdmin();
  const [emails, setEmails] = useState<IEmail[]>(
    () => emailListCache.current.get(accountId) ?? [],
  );
  const [loading, setLoading] = useState(
    () => !emailListCache.current.has(accountId),
  );
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Responses can land out of order (a slow search behind the interval
  // refetch); only the newest request may write state.
  const requestSeqRef = useRef(0);

  const fetchEmails = useCallback(
    async (pageNum: number, searchQuery: string, append: boolean) => {
      const seq = ++requestSeqRef.current;
      const params = new URLSearchParams({
        page: String(pageNum),
        limit: String(PAGE_SIZE),
      });
      if (searchQuery) params.set("search", searchQuery);

      try {
        const result = await client.get<EmailListResponse>(
          `email-accounts/${accountId}/emails?${params}`,
        );
        if (seq !== requestSeqRef.current) return;
        setEmails((current) => {
          const next = append ? [...current, ...result.emails] : result.emails;
          if (!searchQuery) emailListCache.current.set(accountId, next);
          return next;
        });
        setTotal(result.total);
        setPage(pageNum);
      } catch {
        // keep the current list on a failed fetch
      }
      if (seq !== requestSeqRef.current) return;
      setLoading(false);
      setLoadingMore(false);
      setSearching(false);
    },
    [client, accountId, emailListCache],
  );

  useEffect(() => {
    void fetchEmails(1, "", false);
  }, [fetchEmails]);

  useEffect(() => {
    if (activeSearch) return;
    const interval = setInterval(() => {
      void fetchEmails(1, "", false);
    }, REFETCH_INTERVAL);
    return () => clearInterval(interval);
  }, [activeSearch, fetchEmails]);

  useEffect(
    () => () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    },
    [],
  );

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(
      () => {
        setActiveSearch(value);
        setSearching(true);
        void fetchEmails(1, value, false);
      },
      value ? SEARCH_DEBOUNCE_MS : 0,
    );
  };

  const handleSelect = (email: IEmail) => {
    // Opening a message marks it seen on the server; mirror it so the dot
    // does not linger until the next refetch.
    if (!email.seen) {
      setEmails((current) => {
        const next = current.map((item) =>
          item._id === email._id ? { ...item, seen: true } : item,
        );
        if (!activeSearch) emailListCache.current.set(accountId, next);
        return next;
      });
    }
    onSelectEmail(email);
  };

  const unreadCount = emails.filter((e) => !e.seen).length;
  const hasMore = page * PAGE_SIZE < total;

  return (
    <SplitList
      header={
        <>
          <SearchField
            value={search}
            onChange={handleSearchChange}
            placeholder="Search mail"
          />
          <div className="flex items-center gap-2 px-1 text-xs tabular-nums text-muted-foreground">
            {loading ? (
              <Skeleton className="h-2.5 w-24" />
            ) : (
              <span>
                {total} {activeSearch ? "results" : "messages"}
                {unreadCount > 0 ? ` · ${unreadCount} unread` : ""}
              </span>
            )}
            {searching ? <Spinner className="size-3" /> : null}
          </div>
        </>
      }
    >
      {loading ? (
        <EmailListSkeleton />
      ) : emails.length === 0 ? (
        <EmptyState
          icon={<Mail />}
          label={activeSearch ? "No results" : "No mail"}
          action={
            activeSearch ? undefined : (
              <Button
                variant="ghost"
                size="sm"
                onClick={onSync}
                disabled={syncing}
              >
                {syncing ? <Spinner className="size-3.5" /> : <RefreshCw />}
                Sync
              </Button>
            )
          }
        />
      ) : (
        <>
          <List>
            {emails.map((email) => (
              <ListRow
                key={email._id}
                selected={selectedEmailId === email._id}
                onClick={() => handleSelect(email)}
                leading={
                  email.seen ? null : (
                    <span
                      role="img"
                      aria-label="Unread"
                      className="size-1.5 rounded-full bg-accent-strong"
                    />
                  )
                }
                title={
                  <span className={cn(!email.seen && "font-semibold")}>
                    {senderLabel(email)}
                  </span>
                }
                description={email.subject || "(No subject)"}
                meta={formatEmailDate(email.date)}
              />
            ))}
          </List>
          {hasMore ? (
            <div className="flex justify-center py-3">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                disabled={loadingMore}
                onClick={() => {
                  setLoadingMore(true);
                  void fetchEmails(page + 1, activeSearch, true);
                }}
              >
                {loadingMore ? <Spinner className="size-3.5" /> : null}
                {total - emails.length} more
              </Button>
            </div>
          ) : null}
        </>
      )}
    </SplitList>
  );
}
