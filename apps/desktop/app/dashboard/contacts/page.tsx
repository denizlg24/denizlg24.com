"use client";

import { contactSchema } from "@repo/schemas";
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
  UserSquare,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { IContact } from "@/lib/data-types";
import { ContactDetailSheet } from "./_components/contact-detail-sheet";

type ContactStatus = IContact["status"];
type StatusFilter = ContactStatus | "all";

const contactStatsSchema = z.object({
  pending: z.number(),
  read: z.number(),
  responded: z.number(),
  archived: z.number(),
  total: z.number(),
});
type ContactStats = z.infer<typeof contactStatsSchema>;

const contactsResponseSchema = z.object({
  contacts: z.array(contactSchema),
  stats: contactStatsSchema,
});

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

function ContactsLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <UserSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Contacts</span>
      </div>
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

export default function ContactsPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [contacts, setContacts] = useState<IContact[]>([]);
  const [stats, setStats] = useState<ContactStats>({
    pending: 0,
    read: 0,
    responded: 0,
    archived: 0,
    total: 0,
  });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedContact, setSelectedContact] = useState<IContact | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const fetchContacts = useCallback(async () => {
    if (!api) return;
    const result = await api.GET({
      endpoint: "contacts",
      schema: contactsResponseSchema,
    });
    if (!("code" in result)) {
      setContacts(result.contacts);
      setStats(result.stats);
    } else {
      toast.error("Failed to load contacts");
    }
    setLoading(false);
  }, [api]);

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
    if (!prev || !api) return;

    handleStatusChange(ticketId, status);

    const result = await api.PATCH<{ success: boolean }>({
      endpoint: `contacts/${ticketId}`,
      body: { status },
    });

    if ("code" in result) {
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
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  if (loadingSettings || loading) {
    return <ContactsLoadingSkeleton />;
  }

  if (!api) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <UserSquare className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Contacts</span>
        </div>
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          Failed to initialize API client.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <UserSquare className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Contacts</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchContacts();
          }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

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
        api={api}
        onStatusChange={handleStatusChange}
        onDelete={handleDelete}
      />
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
