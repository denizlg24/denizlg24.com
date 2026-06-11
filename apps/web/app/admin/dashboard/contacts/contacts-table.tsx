"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  Archive,
  ArrowUpDown,
  Check,
  Eye,
  Mail,
  MoreHorizontal,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ILeanContact } from "@/models/Contact";

interface ContactsTableProps {
  initialContacts: ILeanContact[];
  onStatusChange?: (oldStatus: string, newStatus: string) => void;
}

export function ContactsTable({
  initialContacts,
  onStatusChange,
}: ContactsTableProps) {
  const [contacts, setContacts] = useState<ILeanContact[]>(initialContacts);

  const handleStatusUpdate = async (ticketId: string, newStatus: string) => {
    const contact = contacts.find((c) => c.ticketId === ticketId);
    const oldStatus = contact?.status;

    try {
      const response = await fetch(`/api/admin/contacts/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) throw new Error("Failed to update status");

      setContacts((prev) =>
        prev.map((contact) =>
          contact.ticketId === ticketId
            ? { ...contact, status: newStatus as any }
            : contact,
        ),
      );

      if (onStatusChange && oldStatus) {
        onStatusChange(oldStatus, newStatus);
      }

      toast.success(`Contact marked as ${newStatus}`);
    } catch (error) {
      console.error("Error updating status:", error);
      toast.error("Failed to update status");
    }
  };

  const columns: ColumnDef<ILeanContact>[] = [
    {
      accessorKey: "ticketId",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Ticket ID
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <code className="text-xs bg-muted px-2 py-1 rounded">
          {row.getValue("ticketId")}
        </code>
      ),
    },
    {
      accessorKey: "name",
      header: "Name",
    },
    {
      accessorKey: "email",
      header: "Email",
    },
    {
      accessorKey: "message",
      header: "Message",
      cell: ({ row }) => (
        <div className="max-w-xs truncate">{row.getValue("message")}</div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.getValue("status") as string;
        return (
          <Badge
            variant={
              status === "pending"
                ? "default"
                : status === "read"
                  ? "secondary"
                  : status === "responded"
                    ? "default"
                    : "secondary"
            }
          >
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: "emailSent",
      header: "Email",
      cell: ({ row }) => (
        <Badge variant={row.getValue("emailSent") ? "default" : "secondary"}>
          {row.getValue("emailSent") ? "✓ Sent" : "Pending"}
        </Badge>
      ),
    },
    {
      accessorKey: "createdAt",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Date
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => {
        const date = new Date(row.getValue("createdAt"));
        return <div className="text-sm">{date.toLocaleDateString()}</div>;
      },
    },
    {
      accessorKey: "ipAddress",
      header: "IP",
      cell: ({ row }) => (
        <div className="text-xs text-muted-foreground">
          {row.getValue("ipAddress")}
        </div>
      ),
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const contact = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`/admin/dashboard/contacts/${contact.ticketId}`}>
                  <Eye className="mr-2 h-4 w-4" />
                  View Details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => handleStatusUpdate(contact.ticketId, "read")}
                disabled={contact.status === "read"}
              >
                <Mail className="mr-2 h-4 w-4" />
                Mark as Read
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  handleStatusUpdate(contact.ticketId, "responded")
                }
                disabled={contact.status === "responded"}
              >
                <Check className="mr-2 h-4 w-4" />
                Mark as Responded
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => handleStatusUpdate(contact.ticketId, "archived")}
                disabled={contact.status === "archived"}
              >
                <Archive className="mr-2 h-4 w-4" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={contacts}
      searchPlaceholder="Search by ticket ID or email..."
      searchableColumns={["ticketId", "email"]}
    />
  );
}
