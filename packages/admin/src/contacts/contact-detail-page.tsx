"use client";

import type { IContact } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { Page, PageBody, PageHeader, PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import {
  CircleDot,
  Clock,
  Copy,
  Globe,
  Hash,
  Mail,
  Monitor,
  Reply,
  Trash2,
  User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { formatRelativeDate } from "../projects/document-editor";
import { useAdmin } from "../provider";
import { CONTACT_STATUS_BADGE, type ContactStatus } from "./contact-status";

const ICON = <User />;
const STATUSES: ContactStatus[] = ["pending", "read", "responded", "archived"];

function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ContactShell({
  title,
  actions,
  children,
}: {
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { slots, routes } = useAdmin();
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={[
          {
            label: "Contacts",
            onClick: () => router.push(routes.contacts.root),
          },
        ]}
        icon={ICON}
        title={title}
      >
        {actions}
      </PageHeader>
      <PageBody width="narrow">{children}</PageBody>
    </Page>
  );
}

export function ContactDetailPage({ ticketId }: { ticketId: string }) {
  const { client, platform, routes } = useAdmin();
  const router = useRouter();

  const [contact, setContact] = useState<IContact | null>(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <ContactShell title={ticketId}>
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="grid h-8 grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3"
            >
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-4 w-2/5" />
            </div>
          ))}
        </div>
        <Skeleton className="h-32 w-full" />
      </ContactShell>
    );
  }

  if (!contact) {
    return (
      <ContactShell title={ticketId}>
        <EmptyState icon={ICON} label="Contact not found" />
      </ContactShell>
    );
  }

  const badge = CONTACT_STATUS_BADGE[contact.status];

  const handleStatusChange = async (status: ContactStatus) => {
    const previous = contact.status;
    if (previous === status) return;
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
    try {
      await client.del<{ success: boolean }>(`contacts/${contact.ticketId}`);
      toast.success("Contact deleted");
      router.push(routes.contacts.root);
    } catch {
      toast.error("Failed to delete contact");
    }
  };

  const copy = async (text: string, label: string) => {
    await platform.copyText(text);
    toast.success(`${label} copied`);
  };

  return (
    <ContactShell
      title={<span className="font-mono">{contact.ticketId}</span>}
      actions={
        <>
          <ConfirmButton
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Delete contact"
              >
                <Trash2 />
              </Button>
            }
            title="Delete contact?"
            description={`Ticket ${contact.ticketId} will be permanently deleted.`}
            actionLabel="Delete"
            destructive
            onConfirm={handleDelete}
          />
          <Button size="sm" asChild>
            <a href={`mailto:${contact.email}`}>
              <Reply />
              Reply
            </a>
          </Button>
        </>
      }
    >
      <PageTitle
        title={contact.name}
        meta={
          <>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <span>{contact.email}</span>
            <span className="tabular-nums">
              {formatRelativeDate(contact.createdAt)}
            </span>
          </>
        }
      />

      <Properties>
        <Property icon={<CircleDot />} label="Status">
          <Select
            value={contact.status}
            onValueChange={(value: ContactStatus) =>
              void handleStatusChange(value)
            }
          >
            <SelectTrigger size="sm" aria-label="Status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {CONTACT_STATUS_BADGE[status].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Property>
        <Property icon={<Mail />} label="Email">
          <span className="group/copy flex min-w-0 items-center gap-1">
            <a
              href={`mailto:${contact.email}`}
              className="truncate hover:underline"
            >
              {contact.email}
            </a>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Copy email"
              className="text-muted-foreground"
              onClick={() => void copy(contact.email, "Email")}
            >
              <Copy />
            </Button>
          </span>
        </Property>
        <Property icon={<Clock />} label="Received">
          <span className="tabular-nums">
            {formatFullDate(contact.createdAt)}
          </span>
        </Property>
        <Property icon={<Hash />} label="Ticket">
          <span className="font-mono text-xs">{contact.ticketId}</span>
        </Property>
        <Property icon={<Globe />} label="IP">
          <span className="font-mono text-xs">{contact.ipAddress || "—"}</span>
        </Property>
        <Property icon={<Monitor />} label="User agent">
          <span
            className="block truncate text-xs text-muted-foreground"
            title={contact.userAgent}
          >
            {contact.userAgent || "—"}
          </span>
        </Property>
      </Properties>

      <Section title="Message">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-accent-strong">
          {contact.message}
        </p>
      </Section>
    </ContactShell>
  );
}
