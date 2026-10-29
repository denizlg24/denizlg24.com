"use client";

import type { IContact } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton, ConfirmDialog } from "@repo/ui/confirm-button";
import { SortHeader } from "@repo/ui/data-table";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { PaginatedDataTable } from "@repo/ui/paginated-data-table";
import { Skeleton } from "@repo/ui/skeleton";
import { TableSkeleton } from "@repo/ui/skeleton-blocks";
import {
  FilterTabs,
  RowActions,
  SearchField,
  ToolbarSpacer,
} from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  BookOpen,
  Eye,
  MessageSquare,
  RefreshCw,
  Trash2,
  UserSquare,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { formatRelativeDate } from "../projects/document-editor";
import { useAdmin } from "../provider";
import { CONTACT_STATUS_BADGE, type ContactStatus } from "./contact-status";

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

const ICON = <UserSquare />;

function ContactsHeader({ children }: { children?: ReactNode }) {
  const { slots } = useAdmin();
  return (
    <PageHeader leading={slots?.sidebarTrigger} icon={ICON} title="Contacts">
      {children}
    </PageHeader>
  );
}

export function ContactsSkeleton() {
  return (
    <Page>
      <ContactsHeader />
      <PageToolbar>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-80" />
      </PageToolbar>
      <PageBody width="wide">
        <TableSkeleton
          rows={8}
          widths={["w-20", "w-24", "w-36", "flex-1", "w-16", "w-16", "w-8"]}
        />
      </PageBody>
    </Page>
  );
}

function matchesQuery(contact: IContact, query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return (
    contact.name.toLowerCase().includes(needle) ||
    contact.email.toLowerCase().includes(needle) ||
    contact.message.toLowerCase().includes(needle) ||
    contact.ticketId.toLowerCase().includes(needle)
  );
}

export function ContactsPage() {
  const { client, routes } = useAdmin();
  const router = useRouter();

  const [contacts, setContacts] = useState<IContact[]>([]);
  const [stats, setStats] = useState<ContactStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<IContact | null>(null);

  const fetchContacts = useCallback(async () => {
    try {
      const result = await client.get<ContactsResponse>("contacts");
      setContacts(result.contacts);
      setStats(result.stats);
    } catch {
      toast.error("Failed to load contacts");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchContacts();
  }, [fetchContacts]);

  const visibleContacts = useMemo(
    () =>
      contacts.filter(
        (contact) =>
          (filter === "all" || contact.status === filter) &&
          matchesQuery(contact, query.trim()),
      ),
    [contacts, filter, query],
  );

  // Moves one contact between statuses. Both ends are explicit so a rollback
  // cannot read a stale list and cancel itself out.
  const moveStatus = useCallback(
    (ticketId: string, from: ContactStatus, to: ContactStatus) => {
      if (from === to) return;
      setContacts((prev) =>
        prev.map((c) => (c.ticketId === ticketId ? { ...c, status: to } : c)),
      );
      setStats((prev) => ({
        ...prev,
        [from]: prev[from] - 1,
        [to]: prev[to] + 1,
      }));
    },
    [],
  );

  const handleQuickStatus = useCallback(
    async (contact: IContact, status: ContactStatus) => {
      moveStatus(contact.ticketId, contact.status, status);
      try {
        await client.patch<{ success: boolean }>(
          `contacts/${contact.ticketId}`,
          { status },
        );
      } catch {
        toast.error("Failed to update status");
        moveStatus(contact.ticketId, status, contact.status);
      }
    },
    [client, moveStatus],
  );

  const handleConfirmDelete = async () => {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      await client.del<{ success: boolean }>(`contacts/${target.ticketId}`);
      setContacts((prev) => prev.filter((c) => c.ticketId !== target.ticketId));
      setStats((prev) => ({
        ...prev,
        [target.status]: prev[target.status] - 1,
        total: prev.total - 1,
      }));
      toast.success("Contact deleted");
    } catch {
      toast.error("Failed to delete contact");
    }
  };

  const handleDeleteArchived = async () => {
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
    } catch {
      toast.error("Failed to delete archived contacts");
    }
  };

  const openContact = useCallback(
    (contact: IContact) =>
      router.push(routes.contacts.detail(contact.ticketId)),
    [router, routes],
  );

  const columns = useMemo<ColumnDef<IContact, unknown>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortHeader label="Name" column={column} />,
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <span
              className={cn(
                "block max-w-48 truncate text-accent-strong",
                row.original.status === "pending" && "font-medium",
              )}
            >
              {row.original.name}
            </span>
            <span className="block max-w-48 truncate text-[11px] text-muted-foreground md:hidden">
              {row.original.email}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: "Email",
        meta: { className: "hidden md:table-cell" },
        cell: ({ row }) => (
          <span className="block max-w-56 truncate text-muted-foreground">
            {row.original.email}
          </span>
        ),
      },
      {
        accessorKey: "message",
        header: "Message",
        enableSorting: false,
        meta: { className: "hidden lg:table-cell" },
        cell: ({ row }) => (
          <span className="block max-w-[26rem] truncate text-muted-foreground">
            {row.original.message}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const badge = CONTACT_STATUS_BADGE[row.original.status];
          return <Badge variant={badge.variant}>{badge.label}</Badge>;
        },
      },
      {
        accessorKey: "ticketId",
        header: "Ticket",
        meta: { className: "hidden xl:table-cell" },
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground">
            {row.original.ticketId}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => <SortHeader label="Date" column={column} />,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {formatRelativeDate(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        meta: { className: "w-10" },
        cell: ({ row }) => {
          const contact = row.original;
          return (
            <RowActions>
              <DropdownMenuItem onClick={() => openContact(contact)}>
                <Eye />
                Open
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {contact.status !== "read" ? (
                <DropdownMenuItem
                  onClick={() => void handleQuickStatus(contact, "read")}
                >
                  <BookOpen />
                  Mark read
                </DropdownMenuItem>
              ) : null}
              {contact.status !== "responded" ? (
                <DropdownMenuItem
                  onClick={() => void handleQuickStatus(contact, "responded")}
                >
                  <MessageSquare />
                  Mark responded
                </DropdownMenuItem>
              ) : null}
              {contact.status !== "archived" ? (
                <DropdownMenuItem
                  onClick={() => void handleQuickStatus(contact, "archived")}
                >
                  <Archive />
                  Archive
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => setDeleteTarget(contact)}
              >
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </RowActions>
          );
        },
      },
    ],
    [handleQuickStatus, openContact],
  );

  if (loading) return <ContactsSkeleton />;

  return (
    <Page>
      <ContactsHeader>
        <ConfirmButton
          trigger={
            <Button variant="ghost" size="sm" disabled={stats.archived === 0}>
              <Trash2 />
              Delete archived
            </Button>
          }
          title="Delete archived contacts?"
          description={`${stats.archived} archived ${stats.archived === 1 ? "contact" : "contacts"} will be permanently deleted.`}
          actionLabel="Delete"
          destructive
          onConfirm={handleDeleteArchived}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void fetchContacts();
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
      </ContactsHeader>

      <PageToolbar>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Search name, email, message"
          className="w-64"
        />
        <FilterTabs<StatusFilter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: stats.total },
            { value: "pending", label: "Pending", count: stats.pending },
            { value: "read", label: "Read", count: stats.read },
            { value: "responded", label: "Responded", count: stats.responded },
            { value: "archived", label: "Archived", count: stats.archived },
          ]}
        />
        <ToolbarSpacer />
      </PageToolbar>

      <PageBody width="wide">
        {contacts.length === 0 ? (
          <EmptyState icon={ICON} label="No contacts" />
        ) : (
          <PaginatedDataTable
            columns={columns}
            data={visibleContacts}
            emptyMessage="No matching contacts"
            initialSorting={[{ id: "createdAt", desc: true }]}
            onRowClick={openContact}
          />
        )}
      </PageBody>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete contact?"
        description={
          deleteTarget
            ? `Ticket ${deleteTarget.ticketId} will be permanently deleted.`
            : undefined
        }
        actionLabel="Delete"
        destructive
        onConfirm={handleConfirmDelete}
      />
    </Page>
  );
}
