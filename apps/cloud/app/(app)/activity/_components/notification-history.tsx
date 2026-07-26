"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { SafeNotificationEvent } from "@repo/schemas/cloud";
import { Button } from "@repo/ui/button";
import { Section } from "@repo/ui/section";
import { StatusDot } from "@repo/ui/status-dot";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { severityTone } from "./tone";

export function NotificationHistory({
  events,
  onChanged,
}: {
  events: SafeNotificationEvent[];
  onChanged: () => void;
}) {
  const [sending, setSending] = useState(false);

  const sendTest = async () => {
    setSending(true);
    try {
      const { deliveries } = await api.notifications.test();
      const enabled = deliveries.filter((delivery) => delivery.enabled);
      if (enabled.length === 0) {
        toast.error("No notification channel is configured");
      } else {
        for (const delivery of enabled) {
          if (delivery.sent) toast.success(`${delivery.channel} delivered`);
          else
            toast.error(`${delivery.channel}: ${delivery.error ?? "failed"}`);
        }
      }
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSending(false);
    }
  };

  return (
    <Section
      title="notifications"
      count={events.length}
      actions={
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={sending}
          onClick={() => void sendTest()}
        >
          {sending ? "sending…" : "send test"}
        </Button>
      }
    >
      <div className="flex flex-col divide-y">
        {events.map((event) => (
          <div
            key={event.id}
            className="flex items-center gap-3 py-1.5 text-xs"
          >
            <StatusDot
              tone={severityTone(event.severity)}
              label={event.severity}
            />
            <span className="w-40 shrink-0 truncate font-mono">
              {event.type}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              {event.lastPayload?.title ?? event.eventKey}
            </span>
            <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
              {event.sendCount}×
            </span>
            <span
              className="w-20 shrink-0 text-right tabular-nums text-muted-foreground"
              title="suppressed inside the cooldown"
            >
              {event.suppressedCount > 0 ? `${event.suppressedCount} held` : ""}
            </span>
            <span className="w-24 shrink-0 text-right tabular-nums text-muted-foreground">
              {formatRelative(event.lastSentAt ?? event.lastSeenAt)}
            </span>
          </div>
        ))}
        {events.length === 0 && (
          <span className="py-2 text-xs text-muted-foreground">—</span>
        )}
      </div>
    </Section>
  );
}
