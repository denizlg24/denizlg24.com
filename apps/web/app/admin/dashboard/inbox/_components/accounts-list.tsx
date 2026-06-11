"use client";

import { Mail, MoreVertical, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import useSWR from "swr";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddAccountDialog } from "./add-account-dialog";

interface EmailAccount {
  _id: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  inboxName: string;
  lastUid: number;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function AccountsList() {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/email-accounts",
    fetcher,
    {
      refreshInterval: 60000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
    },
  );

  const accounts = data?.accounts || [];

  const handleDelete = async () => {
    if (!accountToDelete) return;

    setDeleting(true);
    try {
      const response = await fetch(
        `/api/admin/email-accounts/${accountToDelete}`,
        {
          method: "DELETE",
        },
      );

      if (response.ok) {
        mutate(
          {
            accounts: accounts.filter(
              (acc: EmailAccount) => acc._id !== accountToDelete,
            ),
          },
          false,
        );
        setDeleteDialogOpen(false);
        setAccountToDelete(null);
        toast.success("Email account deleted successfully");

        mutate();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to delete account");
      }
    } catch (error) {
      console.error("Error deleting account:", error);
      toast.error("Failed to delete account");
    } finally {
      setDeleting(false);
    }
  };

  const handleSync = async (_accountId: string) => {
    toast.loading("Syncing emails...", { id: "email-sync" });
    try {
      const response = await fetch("/api/admin/email-accounts/sync", {
        method: "POST",
      });

      if (response.ok) {
        const data = await response.json();
        toast.success(data.message || "Email sync completed successfully", {
          id: "email-sync",
        });

        mutate();
      } else {
        const error = await response.json();
        toast.error(error.error || "Failed to sync emails", {
          id: "email-sync",
        });
      }
    } catch (error) {
      console.error("Error syncing emails:", error);
      toast.error("Failed to sync emails", { id: "email-sync" });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4 pl-2 animate-in fade-in duration-300">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl sm:text-2xl font-semibold">Email Accounts</h2>
        </div>
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground animate-pulse">
          Loading accounts...
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4 pl-2 animate-in fade-in duration-300">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl sm:text-2xl font-semibold">Email Accounts</h2>
          <Button onClick={() => setAddDialogOpen(true)} size="sm">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Add Account</span>
          </Button>
        </div>

        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center gap-3 sm:gap-4 py-8">
            <div className="rounded-full bg-muted p-3 sm:p-4">
              <Mail className="w-6 h-6 sm:w-8 sm:h-8 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold text-base sm:text-lg mb-2">
                No Email Accounts
              </h3>
              <p className="text-xs sm:text-sm text-muted-foreground mb-3 sm:mb-4">
                Add your first email account to start receiving and managing
                emails.
              </p>
              <Button onClick={() => setAddDialogOpen(true)} size="sm">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Account
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map((account: EmailAccount) => (
              <Card key={account._id} className="p-3 sm:p-4">
                <div className="flex items-start justify-between gap-2 sm:gap-4">
                  <div className="flex items-start gap-2 sm:gap-3 flex-1 min-w-0">
                    <div className="rounded-full bg-primary/10 p-1.5 sm:p-2 shrink-0 mt-0.5 sm:mt-1">
                      <Mail className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-sm sm:text-base truncate">
                        {account.user}
                      </h3>
                      <p className="text-xs sm:text-sm text-muted-foreground truncate">
                        {account.host}:{account.port}
                      </p>
                      <div className="flex items-center gap-1.5 sm:gap-2 mt-1.5 sm:mt-2 flex-wrap">
                        <Badge
                          variant="secondary"
                          className="text-[10px] sm:text-xs"
                        >
                          {account.inboxName}
                        </Badge>
                        {account.secure && (
                          <Badge
                            variant="outline"
                            className="text-[10px] sm:text-xs"
                          >
                            SSL/TLS
                          </Badge>
                        )}
                        <span className="text-[10px] sm:text-xs text-muted-foreground">
                          Last UID: {account.lastUid}
                        </span>
                      </div>
                    </div>
                  </div>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 sm:h-10 sm:w-10"
                      >
                        <MoreVertical className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleSync(account._id)}
                        className="text-xs sm:text-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-2" />
                        Sync Now
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive text-xs sm:text-sm"
                        onClick={() => {
                          setAccountToDelete(account._id);
                          setDeleteDialogOpen(true);
                        }}
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AddAccountDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        onAccountAdded={() => mutate()}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base sm:text-lg">
              Delete Email Account
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs sm:text-sm">
              Are you sure you want to delete this email account? This will also
              delete all associated emails. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="text-xs sm:text-sm"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90 text-xs sm:text-sm"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
