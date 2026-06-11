"use client";

import { format } from "date-fns";
import { Loader2, Mail, MailOpen, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

interface Email {
  _id: string;
  subject: string;
  from: { name?: string; address: string }[];
  date: string;
  seen: boolean;
  messageId?: string;
}

interface FullEmail extends Email {
  textBody?: string;
  htmlBody?: string;
  rawSource?: string;
}

interface EmailListProps {
  accountId: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function EmailList({ accountId }: EmailListProps) {
  const [syncing, setSyncing] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [fullEmail, setFullEmail] = useState<FullEmail | null>(null);
  const [loadingEmail, setLoadingEmail] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/email-accounts/${accountId}/emails`,
    fetcher,
    {
      refreshInterval: 30000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      dedupingInterval: 2000,
    },
  );

  const emails = data?.emails || [];

  const handleSync = async () => {
    setSyncing(true);
    toast.loading("Syncing emails...", { id: "email-sync" });
    try {
      const response = await fetch("/api/admin/email-accounts/sync", {
        method: "POST",
      });

      if (response.ok) {
        const result = await response.json();
        toast.success(result.message || "Email sync completed successfully", {
          id: "email-sync",
        });

        await mutate();
        setSyncing(false);
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to sync emails", {
          id: "email-sync",
        });
        setSyncing(false);
      }
    } catch (error) {
      console.error("Error syncing emails:", error);
      toast.error("Failed to sync emails", { id: "email-sync" });
      setSyncing(false);
    }
  };

  const handleEmailClick = async (email: Email) => {
    setSelectedEmail(email);
    setLoadingEmail(true);
    setFullEmail(null);

    try {
      const response = await fetch(
        `/api/admin/email-accounts/${accountId}/emails/${email._id}`,
      );

      if (response.ok) {
        const data = await response.json();
        setFullEmail(data.email);
        mutate();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to load email");
        setSelectedEmail(null);
      }
    } catch (error) {
      console.error("Error loading email:", error);
      toast.error("Failed to load email");
      setSelectedEmail(null);
    } finally {
      setLoadingEmail(false);
    }
  };

  const handleCloseDrawer = () => {
    setSelectedEmail(null);
    setFullEmail(null);
  };

  if (isLoading) {
    return (
      <div className="h-full flex flex-col animate-in fade-in duration-300">
        <div className="border-b p-3 sm:p-4 flex items-center justify-between gap-2">
          <h1 className="text-xl sm:text-2xl font-semibold">Inbox</h1>
        </div>
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground animate-pulse">
          Loading emails...
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-300 overflow-hidden">
      <div className="border-b p-3 sm:p-4 flex items-center justify-between gap-2">
        <h1 className="text-xl sm:text-2xl font-semibold">Inbox</h1>
        <Button onClick={handleSync} disabled={syncing} size="sm">
          {syncing ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          <span className="hidden sm:inline">
            {syncing ? "Syncing..." : "Sync"}
          </span>
          <span className="sm:hidden">{syncing ? "..." : "Sync"}</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {emails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 sm:p-12">
            <div className="rounded-full bg-muted p-3 sm:p-4 mb-3 sm:mb-4">
              <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground" />
            </div>
            <h3 className="font-semibold text-base sm:text-lg mb-2">
              No emails yet
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
              Click sync to fetch your emails
            </p>
            <Button onClick={handleSync} disabled={syncing} size="sm">
              {syncing ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4 mr-2" />
              )}
              {syncing ? "Syncing..." : "Sync Now"}
            </Button>
          </div>
        ) : (
          <div className="divide-y w-full">
            {emails.map((email: Email) => (
              <div
                key={email._id}
                className="p-3 sm:p-4 hover:bg-muted/50 cursor-pointer transition-colors w-full"
                onClick={() => handleEmailClick(email)}
              >
                <div className="flex items-start gap-2 sm:gap-3 w-full">
                  <div className="shrink-0 mt-1">
                    {email.seen ? (
                      <MailOpen className="w-4 h-4 sm:w-5 sm:h-5 text-muted-foreground" />
                    ) : (
                      <Mail className="w-4 h-4 sm:w-5 sm:h-5 text-primary" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1 overflow-hidden">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <p
                        className={`text-xs sm:text-sm truncate ${
                          email.seen ? "font-normal" : "font-semibold"
                        }`}
                      >
                        {email.from[0]?.name || email.from[0]?.address}
                      </p>
                      <span
                        className="text-[10px] sm:text-xs text-muted-foreground shrink-0"
                        suppressHydrationWarning
                      >
                        {format(new Date(email.date), "MMM d, h:mm a")}
                      </span>
                    </div>

                    <p
                      className={`text-xs sm:text-sm truncate ${
                        email.seen
                          ? "text-muted-foreground"
                          : "text-foreground font-medium"
                      }`}
                    >
                      {email.subject}
                    </p>

                    {!email.seen && (
                      <Badge
                        variant="default"
                        className="mt-1 sm:mt-2 text-[10px] sm:text-xs w-fit"
                      >
                        Unread
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Drawer open={selectedEmail !== null} onOpenChange={handleCloseDrawer}>
        <DrawerContent className="min-h-[80vh] max-h-[90vh]">
          <DrawerHeader className="border-b py-3 px-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <DrawerTitle className="text-sm sm:text-base font-semibold truncate">
                  {selectedEmail?.subject || "(No Subject)"}
                </DrawerTitle>
                <div className="flex mx-auto w-full text-center items-center justify-center gap-2 text-xs text-muted-foreground mt-1">
                  <span className="truncate max-w-50 sm:max-w-75">
                    {selectedEmail?.from[0]?.name ||
                      selectedEmail?.from[0]?.address}
                  </span>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="shrink-0" suppressHydrationWarning>
                    {selectedEmail &&
                      format(
                        new Date(selectedEmail.date),
                        "MMM d, yyyy, h:mm a",
                      )}
                  </span>
                </div>
              </div>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {loadingEmail ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
              </div>
            ) : fullEmail ? (
              <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-3 mb-4 pb-4 border-b">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold">
                    {(fullEmail.from[0]?.name ||
                      fullEmail.from[0]?.address ||
                      "?")[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">
                      {fullEmail.from[0]?.name || fullEmail.from[0]?.address}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {fullEmail.from[0]?.address}
                    </p>
                  </div>
                </div>

                {fullEmail.htmlBody ? (
                  <div
                    className="prose prose-sm sm:prose max-w-none mx-auto text-foreground!"
                    dangerouslySetInnerHTML={{ __html: fullEmail.htmlBody }}
                  />
                ) : fullEmail.textBody ? (
                  <div className="whitespace-pre-wrap font-mono text-xs sm:text-sm">
                    {fullEmail.textBody}
                  </div>
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    No email body available
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <DrawerFooter className="border-t">
            <DrawerClose asChild>
              <Button variant="outline" className="w-full sm:w-auto">
                Close
              </Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
