"use client";

import { Ban, Check, Clock, ExternalLink, Loader2, MapPin } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ILeanCalendarEvent } from "@/models/CalendarEvent";
import { useCalendar } from "./calendar-context";

export function TodaysEvents() {
  const { getTodaysEvents, loading, updateEventStatus } = useCalendar();
  const [changingStatus, setChangingStatus] = useState<string | false>(false);

  const events = getTodaysEvents();

  if (loading && events.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No events scheduled for today
      </div>
    );
  }

  const handleStatusChange = async (
    event: ILeanCalendarEvent,
    status: "completed" | "canceled",
  ) => {
    setChangingStatus(status === "completed" ? "complete" : "cancel");
    try {
      await fetch(`/api/admin/calendar/${event._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      updateEventStatus(event._id, status);
    } finally {
      setChangingStatus(false);
    }
  };

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div
          key={event._id}
          className="border rounded-lg p-3 space-y-2 hover:bg-accent/5 transition-colors"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
              <h3 className="font-semibold text-sm wrap-break-word">
                {event.title}
              </h3>
              <Badge
                variant={
                  event.status === "completed"
                    ? "default"
                    : event.status === "canceled"
                      ? "destructive"
                      : "secondary"
                }
                className="text-xs shrink-0"
              >
                {event.status}
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="w-3 h-3 shrink-0" />
            <span>
              {new Date(event.date).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {event.place && (
              <>
                <span>•</span>
                <MapPin className="w-3 h-3 shrink-0" />
                <span>{event.place}</span>
              </>
            )}
          </div>

          {event.links.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {event.links.map((link) => (
                <a
                  key={link._id}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-xs border rounded hover:bg-accent transition-colors"
                >
                  {link.icon ? (
                    <img
                      src={link.icon}
                      alt=""
                      className="w-3 h-3 shrink-0"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                        e.currentTarget.nextElementSibling?.classList.remove(
                          "hidden",
                        );
                      }}
                    />
                  ) : null}
                  <ExternalLink
                    className={cn("w-3 h-3 shrink-0", link.icon && "hidden")}
                  />
                  <span className="truncate">{link.label}</span>
                </a>
              ))}
            </div>
          )}
          <div className="w-full flex flex-row items-center gap-2">
            <Button
              disabled={!!changingStatus || event.status === "completed"}
              size={"sm"}
              className="text-sm"
              onClick={() => handleStatusChange(event, "completed")}
            >
              {changingStatus === "complete" ? (
                <>
                  <Loader2 className="animate-spin" />
                  Completing...
                </>
              ) : (
                <>
                  <Check />
                  {event.status === "completed" ? "Completed" : "Complete"}
                </>
              )}
            </Button>
            <Button
              disabled={!!changingStatus || event.status === "canceled"}
              variant={"secondary"}
              size={"sm"}
              className="text-sm"
              onClick={() => handleStatusChange(event, "canceled")}
            >
              {changingStatus === "cancel" ? (
                <>
                  <Loader2 className="animate-spin" /> Cancelling...
                </>
              ) : (
                <>
                  <Ban />
                  {event.status === "canceled" ? "Canceled" : "Cancel"}
                </>
              )}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
