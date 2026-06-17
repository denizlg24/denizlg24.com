"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@repo/ui/alert-dialog";
import { Button } from "@repo/ui/button";
import { Archive, Check, Clock, Eye, Send, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import type { ILeanContact } from "@/models/Contact";
import { ContactsTable, type ContactsTableHandle } from "./contacts-table";

interface ContactsWrapperProps {
  initialContacts: ILeanContact[];
  initialStats: {
    total: number;
    pending: number;
    read: number;
    responded: number;
    archived: number;
  };
}

export function ContactsWrapper({
  initialContacts,
  initialStats,
}: ContactsWrapperProps) {
  const [stats, setStats] = useState(initialStats);
  const [deletingArchived, setDeletingArchived] = useState(false);
  const tableRef = useRef<ContactsTableHandle>(null);

  const handleStatusChange = (oldStatus: string, newStatus: string) => {
    setStats((prev) => ({
      ...prev,
      [oldStatus]: Math.max(0, prev[oldStatus as keyof typeof prev] - 1),
      [newStatus]: prev[newStatus as keyof typeof prev] + 1,
    }));
  };

  const handleDelete = (status: string) => {
    setStats((prev) => ({
      ...prev,
      [status]: Math.max(0, prev[status as keyof typeof prev] - 1),
      total: Math.max(0, prev.total - 1),
    }));
  };

  const handleDeleteArchived = async () => {
    setDeletingArchived(true);
    try {
      const response = await fetch("/api/admin/contacts/archived", {
        method: "DELETE",
      });

      if (!response.ok) throw new Error("Failed to delete archived contacts");

      const { deletedCount } = (await response.json()) as {
        deletedCount: number;
      };

      tableRef.current?.removeByStatus("archived");
      setStats((prev) => ({
        ...prev,
        archived: 0,
        total: Math.max(0, prev.total - deletedCount),
      }));
      toast.success(
        deletedCount === 1
          ? "Deleted 1 archived contact"
          : `Deleted ${deletedCount} archived contacts`,
      );
    } catch (error) {
      console.error("Error deleting archived contacts:", error);
      toast.error("Failed to delete archived contacts");
    } finally {
      setDeletingArchived(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Send className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.total}
            </span>
            <span className="text-xs text-muted-foreground">Total</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.pending}
            </span>
            <span className="text-xs text-muted-foreground">Pending</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Eye className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.read}
            </span>
            <span className="text-xs text-muted-foreground">Read</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Check className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.responded}
            </span>
            <span className="text-xs text-muted-foreground">Responded</span>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50">
          <Archive className="w-4 h-4 text-muted-foreground" />
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm sm:text-base font-semibold">
              {stats.archived}
            </span>
            <span className="text-xs text-muted-foreground">Archived</span>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5 text-destructive hover:text-destructive"
              disabled={stats.archived === 0 || deletingArchived}
            >
              <Trash2 className="size-3.5" />
              Delete archived
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete all archived contacts?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete all {stats.archived} archived
                contact submissions. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deletingArchived}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={(e) => {
                  e.preventDefault();
                  void handleDeleteArchived();
                }}
                disabled={deletingArchived}
              >
                {deletingArchived ? "Deleting..." : "Delete archived"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <ContactsTable
        ref={tableRef}
        initialContacts={initialContacts}
        onStatusChange={handleStatusChange}
        onDelete={handleDelete}
      />
    </>
  );
}
