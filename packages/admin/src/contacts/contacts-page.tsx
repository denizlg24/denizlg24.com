"use client";

import type { IContact } from "@repo/schemas";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@repo/ui/alert-dialog";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { SortHeader } from "@repo/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { PageHeader } from "@repo/ui/page-header";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Separator } from "@repo/ui/separator";
import { Skeleton } from "@repo/ui/skeleton";
import { TableSkeleton, TabStripSkeleton } from "@repo/ui/skeleton-blocks";
import { Tabs, TabsList, TabsTrigger } from "@repo/ui/tabs";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  BookOpen,
  Eye,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  UserSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { ContactDetailSheet } from "./contact-detail-sheet";

type ContactStatus = IContact["status"];
type StatusFilter = ContactStatus | "all";

interface ContactStats {
  pending: number;
  read: number;
  responded: number;
  archived: number;
  total: number;
}

interface ContactsResponse {
  contacts: IContact[];
  stats: ContactStats;
}

const EMPTY_STATS: ContactStats = {
  pending: 0,
  read: 0,
  responded: 0,
  archived: 0,
  total: 0,
};

const STATUS_CONFIG: Record<
  ContactStatus,
  { label: string; variant: "outline" | "secondary" | "default" | "ghost" }
> = {
  pending: { label: "Pending", variant: "outline" },
  read: { label: "Read", variant: "secondary" },
  responded: { label: "Responded", variant: "default" },
  archived: { label: "Archived", variant: "ghost" },
};

const FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "read", label: "Read" },
  { value: "responded", label: "Responded" },
  { value: "archived", label: "Archived" },
];

function formatRelativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function ContactsSkeleton() {
  const { slots } = useAdmin();
  return (
    <div className="flex flex-col gap-2 pb-8">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<UserSquare className="size-4 text-muted-foreground" />}
        title="Contacts"
      />
      <div className="px-4 flex flex-col gap-6 pt-3">
        <div className="flex items-baseline gap-8">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex flex-col gap-1">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-6 w-8" />
            </div>
          ))}
        </div>
        <TabStripSkeleton widths={["w-10", "w-16", "w-12", "w-20", "w-16"]} />
        <TableSkeleton
          rows={6}
          widths={["w-20", "w-24", "w-36", "flex-1", "w-16", "w-16", "w-8"]}
        />
      </div>
    </div>
  );
}

export function ContactsPage() {
  const { client, slots } = useAdmin();

  const [contacts, setContacts] = useState<IContact[]>([]);
  const [stats, setStats] = useState<ContactStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedContact, setSelectedContact] = useState<IContact | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IContact | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteArchivedOpen, setDeleteArchivedOpen] = useState(false);
  const [deletingArchived, setDeletingArchived] = useState(false);

  const fetchContacts = useCallback(async () => {
    try {
      const result = await client.get<ContactsResponse>("contacts");
      setContacts(result.contacts);
      setStats(result.stats);
    } catch {
      toast.error("Failed to load contacts");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const filteredContacts = useMemo(() => {
    if (filter === "all") return contacts;
    return contacts.filter((c) => c.status === filter);
  }, [contacts, filter]);

  const handleStatusChange = (ticketId: string, newStatus: ContactStatus) => {
    setContacts((prev) =>
      prev.map((c) =>
        c.ticketId === ticketId ? { ...c, status: newStatus } : c,
      ),
    );

    setStats((prev) => {
      const contact = contacts.find((c) => c.ticketId === ticketId);
      if (!contact) return prev;
      return {
        ...prev,
        [contact.status]: prev[contact.status] - 1,
        [newStatus]: prev[newStatus] + 1,
      };
    });

    if (selectedContact?.ticketId === ticketId) {
      setSelectedContact((prev) =>
        prev ? { ...prev, status: newStatus } : null,
      );
    }
  };

  const handleDelete = (ticketId: string) => {
    const contact = contacts.find((c) => c.ticketId === ticketId);
    setContacts((prev) => prev.filter((c) => c.ticketId !== ticketId));
    if (contact) {
      setStats((prev) => ({
        ...prev,
        [contact.status]: prev[contact.status] - 1,
        total: prev.total - 1,
      }));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await client.del<{ success: boolean }>(
        `contacts/${deleteTarget.ticketId}`,
      );
      handleDelete(deleteTarget.ticketId);
      if (selectedContact?.ticketId === deleteTarget.ticketId) {
        setSheetOpen(false);
      }
      toast.success("Contact deleted");
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete contact");
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteArchived = async () => {
    setDeletingArchived(true);
    try {
      const result = await client.del<{
        success: boolean;
        deletedCount: number;
      }>("contacts/archived");
      setContacts((prev) => prev.filter((c) => c.status !== "archived"));
      setStats((prev) => ({
        ...prev,
        archived: 0,
        total: Math.max(0, prev.total - result.deletedCount),
      }));
      toast.success(
        result.deletedCount === 1
          ? "Deleted 1 archived contact"
          : `Deleted ${result.deletedCount} archived contacts`,
      );
      setDeleteArchivedOpen(false);
    } catch {
      toast.error("Failed to delete archived contacts");
    } finally {
      setDeletingArchived(false);
    }
  };

  const handleRowClick = (contact: IContact) => {
    setSelectedContact(contact);
    setSheetOpen(true);
  };

  const handleQuickStatus = async (
    e: React.MouseEvent,
    ticketId: string,
    status: ContactStatus,
  ) => {
    e.stopPropagation();
    const prev = contacts.find((c) => c.ticketId === ticketId);
    if (!prev) return;

    handleStatusChange(ticketId, status);

    try {
      await client.patch<{ success: boolean }>(`contacts/${ticketId}`, {
        status,
      });
    } catch {
      toast.error("Failed to update status");
      handleStatusChange(ticketId, prev.status);
    }
  };

  const columns: ColumnDef<IContact, unknown>[] = [
    {
      accessorKey: "ticketId",
      header: "Ticket",
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => (
        <span className="font-mono text-muted-foreground">
          {row.getValue("ticketId")}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <span className="block max-w-36 truncate font-medium lg:max-w-none">
          {row.getValue("name")}
        </span>
      ),
    },
    {
      accessorKey: "email",
      header: "Email",
      meta: { className: "hidden md:table-cell" },
      cell: ({ row }) => (
        <span className="block max-w-52 truncate text-muted-foreground xl:max-w-none">
          {row.getValue("email")}
        </span>
      ),
    },
    {
      accessorKey: "message",
      header: "Message",
      meta: { className: "hidden lg:table-cell" },
      cell: ({ row }) => {
        const msg = row.getValue("message") as string;
        return (
          <span className="text-muted-foreground max-w-[200px] truncate block">
            {msg}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.getValue("status") as ContactStatus;
        const config = STATUS_CONFIG[status];
        return (
          <Badge variant={config.variant} className="text-[10px]">
            {config.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => <SortHeader label="Date" column={column} />,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {formatRelativeDate(row.getValue("createdAt"))}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const contact = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  handleRowClick(contact);
                }}
              >
                <Eye className="size-3.5" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {contact.status !== "read" && (
                <DropdownMenuItem
                  onClick={(e) =>
                    handleQuickStatus(e, contact.ticketId, "read")
                  }
                >
                  <BookOpen className="size-3.5" />
                  Mark as Read
                </DropdownMenuItem>
              )}
              {contact.status !== "responded" && (
                <DropdownMenuItem
                  onClick={(e) =>
                    handleQuickStatus(e, contact.ticketId, "responded")
                  }
                >
                  <MessageSquare className="size-3.5" />
                  Mark as Responded
                </DropdownMenuItem>
              )}
              {contact.status !== "archived" && (
                <DropdownMenuItem
                  onClick={(e) =>
                    handleQuickStatus(e, contact.ticketId, "archived")
                  }
                >
                  <Archive className="size-3.5" />
                  Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteTarget(contact);
                }}
              >
                <Trash2 className="size-3.5" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  if (loading) {
    return <ContactsSkeleton />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<UserSquare className="size-4 text-muted-foreground" />}
        title="Contacts"
      >
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive"
          disabled={stats.archived === 0}
          onClick={() => setDeleteArchivedOpen(true)}
          title="Delete archived"
        >
          <Trash2 className="size-3.5" />
          <span className="hidden sm:inline">Delete archived</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchContacts();
          }}
          title="Refresh"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </PageHeader>

      <div className="px-4 flex flex-1 min-h-0 flex-col gap-4 overflow-hidden pt-3 pb-8">
        <div className="grid grid-cols-3 gap-x-8 gap-y-3 md:flex md:flex-wrap md:items-baseline">
          <Stat label="Total" value={stats.total} />
          <Stat
            label="Pending"
            value={stats.pending}
            highlight={stats.pending > 0}
          />
          <Stat label="Read" value={stats.read} />
          <Stat label="Responded" value={stats.responded} />
          <Stat label="Archived" value={stats.archived} />
        </div>

        <Separator />

        <Tabs
          value={filter}
          onValueChange={(v) => setFilter(v as StatusFilter)}
        >
          <TabsList variant="line">
            {FILTER_OPTIONS.map((opt) => (
              <TabsTrigger key={opt.value} value={opt.value}>
                {opt.label}
                {opt.value !== "all" && stats[opt.value] > 0 && (
                  <span className="ml-1 hidden text-[10px] text-muted-foreground tabular-nums md:inline">
                    {stats[opt.value]}
                  </span>
                )}
                {opt.value === "all" && (
                  <span className="ml-1 hidden text-[10px] text-muted-foreground tabular-nums md:inline">
                    {stats.total}
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <div className="min-h-0 flex-1">
          <PaginatedDataTable
            columns={columns}
            data={filteredContacts}
            emptyMessage="No contacts found"
            initialSorting={[{ id: "createdAt", desc: true }]}
            onRowClick={handleRowClick}
            searchPlaceholder="Search name, email, message..."
          />
        </div>
      </div>

      <ContactDetailSheet
        contact={selectedContact}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onStatusChange={handleStatusChange}
        onDelete={handleDelete}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete ticket {deleteTarget?.ticketId}. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={deleteArchivedOpen}
        onOpenChange={setDeleteArchivedOpen}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete all archived contacts?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete all {stats.archived} archived
              contacts. This action cannot be undone.
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
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-lg font-semibold tabular-nums tracking-tight ${
          highlight ? "text-primary" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}
