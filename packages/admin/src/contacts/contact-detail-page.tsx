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
import { Separator } from "@repo/ui/separator";
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
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";

type ContactStatus = IContact["status"];

const ICON = <User className="size-4 text-muted-foreground" />;

const STATUS_CONFIG: Record<
  ContactStatus,
  { label: string; variant: "outline" | "secondary" | "default" | "ghost" }
> = {
  pending: { label: "Pending", variant: "outline" },
  read: { label: "Read", variant: "secondary" },
  responded: { label: "Responded", variant: "default" },
  archived: { label: "Archived", variant: "ghost" },
};

const STATUS_ACTIONS: {
  status: ContactStatus;
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    status: "read",
    label: "Mark as Read",
    icon: <BookOpen className="size-3.5" />,
  },
  {
    status: "responded",
    label: "Mark as Responded",
    icon: <MessageSquare className="size-3.5" />,
  },
  {
    status: "archived",
    label: "Archive",
    icon: <Archive className="size-3.5" />,
  },
];

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

export function ContactDetailPage({ ticketId }: { ticketId: string }) {
  const { client, platform, routes } = useAdmin();
  const router = useRouter();
  const backTo = routes.contacts.root;

  const [contact, setContact] = useState<IContact | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setContact(await client.get<IContact>(`contacts/${ticketId}`));
    } catch {
      toast.error("Failed to load contact");
      setContact(null);
    } finally {
      setLoading(false);
    }
  }, [client, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Opening a pending ticket is what "read" means; the list used to do this on
  // row click and the page has to keep doing it or nothing ever leaves pending.
  useEffect(() => {
    if (contact?.status !== "pending") return;
    setContact({ ...contact, status: "read" });
    client
      .patch<{ success: boolean }>(`contacts/${contact.ticketId}`, {
        status: "read",
      })
      .catch(() => undefined);
  }, [contact, client]);

  const shell = { icon: ICON, backTo, backLabel: "Contacts" } as const;

  if (loading)
    return <DetailPageSkeleton {...shell} title="Contact" rows={2} />;

  if (!contact) {
    return (
      <DetailNotFound
        {...shell}
        title="Contact not found"
        message="This ticket could not be loaded."
      />
    );
  }

  const statusConfig = STATUS_CONFIG[contact.status];

  const handleStatusChange = async (status: ContactStatus) => {
    const previous = contact.status;
    setContact({ ...contact, status });
    try {
      await client.patch<{ success: boolean }>(`contacts/${contact.ticketId}`, {
        status,
      });
    } catch {
      toast.error("Failed to update status");
      setContact({ ...contact, status: previous });
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await client.del<{ success: boolean }>(`contacts/${contact.ticketId}`);
      toast.success("Contact deleted");
      router.push(backTo);
    } catch {
      toast.error("Failed to delete contact");
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    await platform.copyText(text);
    toast.success(`${label} copied`);
  };

  return (
    <>
      <DetailPageShell
        {...shell}
        title={
          <span className="flex items-center gap-2">
            <span className="font-mono">{contact.ticketId}</span>
            <Badge variant={statusConfig.variant} className="text-[10px]">
              {statusConfig.label}
            </Badge>
          </span>
        }
        actions={
          <>
            {STATUS_ACTIONS.filter((a) => a.status !== contact.status).map(
              (action) => (
                <Button
                  key={action.status}
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => handleStatusChange(action.status)}
                >
                  {action.icon}
                  <span className="hidden sm:inline">{action.label}</span>
                </Button>
              ),
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="size-3.5" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2">
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

          <div className="whitespace-pre-wrap rounded-md bg-muted/50 p-4 text-sm leading-relaxed">
            {contact.message}
          </div>

          <Button variant="outline" size="sm" className="w-fit" asChild>
            <a href={`mailto:${contact.email}`}>
              <Mail className="size-3.5" />
              Reply
            </a>
          </Button>
        </div>
      </DetailPageShell>

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
    <div className="group flex items-start gap-2.5">
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
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
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={onCopy}
          className="mt-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Copy className="size-3" />
        </button>
      )}
    </div>
  );
}
