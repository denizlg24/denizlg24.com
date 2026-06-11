"use client";

import {
  Archive,
  BookOpen,
  Clock,
  Copy,
  Globe,
  Mail,
  MessageSquare,
  Monitor,
  Trash2,
  User,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { denizApi } from "@/lib/api-wrapper";
import type { IContact } from "@/lib/data-types";

type ContactStatus = IContact["status"];

const STATUS_CONFIG: Record<
  ContactStatus,
  { label: string; variant: "outline" | "secondary" | "default" | "ghost" }
> = {
  pending: { label: "Pending", variant: "outline" },
  read: { label: "Read", variant: "secondary" },
  responded: { label: "Responded", variant: "default" },
  archived: { label: "Archived", variant: "ghost" },
};

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ContactDetailSheet({
  contact,
  open,
  onOpenChange,
  api,
  onStatusChange,
  onDelete,
}: {
  contact: IContact | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: denizApi;
  onStatusChange: (ticketId: string, status: ContactStatus) => void;
  onDelete: (ticketId: string) => void;
}) {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!contact) return null;

  const statusConfig = STATUS_CONFIG[contact.status];

  const handleStatusChange = async (status: ContactStatus) => {
    onStatusChange(contact.ticketId, status);

    const result = await api.PATCH<{ success: boolean }>({
      endpoint: `contacts/${contact.ticketId}`,
      body: { status },
    });

    if ("code" in result) {
      toast.error("Failed to update status");
      onStatusChange(contact.ticketId, contact.status);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    const result = await api.DELETE<{ success: boolean }>({
      endpoint: `contacts/${contact.ticketId}`,
    });

    if ("code" in result) {
      toast.error("Failed to delete contact");
    } else {
      onDelete(contact.ticketId);
      onOpenChange(false);
      toast.success("Contact deleted");
    }
    setDeleting(false);
    setDeleteDialogOpen(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  };

  const allActions: {
    status: ContactStatus;
    label: string;
    icon: React.ReactNode;
  }[] = [
    {
      status: "read" as const,
      label: "Mark as Read",
      icon: <BookOpen className="size-3.5" />,
    },
    {
      status: "responded" as const,
      label: "Mark as Responded",
      icon: <MessageSquare className="size-3.5" />,
    },
    {
      status: "archived" as const,
      label: "Archive",
      icon: <Archive className="size-3.5" />,
    },
  ];
  const statusActions = allActions.filter((a) => a.status !== contact.status);

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <div className="flex items-center gap-2">
              <SheetTitle className="text-sm">{contact.ticketId}</SheetTitle>
              <Badge variant={statusConfig.variant} className="text-[10px]">
                {statusConfig.label}
              </Badge>
            </div>
            <SheetDescription className="sr-only">
              Contact details for {contact.name}
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-5 px-4 pb-6">
            <div className="flex flex-col gap-3">
              <DetailRow icon={User} label="Name" value={contact.name} />
              <DetailRow
                icon={Mail}
                label="Email"
                value={contact.email}
                copyable
                onCopy={() => copyToClipboard(contact.email, "Email")}
              />
              <DetailRow
                icon={Clock}
                label="Received"
                value={formatFullDate(contact.createdAt)}
              />
              <DetailRow icon={Globe} label="IP" value={contact.ipAddress} />
              <DetailRow
                icon={Monitor}
                label="User Agent"
                value={contact.userAgent}
                truncate
              />
            </div>

            <Separator />

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Message
              </p>
              <div className="rounded-md bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">
                {contact.message}
              </div>
            </div>

            <Separator />

            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                Actions
              </p>
              <div className="flex flex-wrap gap-2">
                {statusActions.map((action) => (
                  <Button
                    key={action.status}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs gap-1.5"
                    onClick={() => handleStatusChange(action.status)}
                  >
                    {action.icon}
                    {action.label}
                  </Button>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setDeleteDialogOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete ticket {contact.ticketId}. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  copyable,
  onCopy,
  truncate,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  copyable?: boolean;
  onCopy?: () => void;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 group">
      <Icon className="size-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <p
          className={`text-sm ${truncate ? "truncate" : ""}`}
          title={truncate ? value : undefined}
        >
          {value}
        </p>
      </div>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity mt-2"
        >
          <Copy className="size-3 text-muted-foreground hover:text-foreground" />
        </button>
      )}
    </div>
  );
}
