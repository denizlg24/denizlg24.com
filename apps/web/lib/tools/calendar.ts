import {
  createCalendarEvent,
  deleteCalendarEvent,
  getCalendarEvents,
  getMonthCalendarEvents,
  updateCalendarEvent,
} from "@/lib/calendar-events";
import { fetchFavicon } from "@/lib/fetch-favicon";
import type { ToolDefinition } from "./types";

type LinkInput = { label: string; url: string; icon?: string }[];

export const calendarTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_calendar_events",
      description:
        "Get calendar events for a date range. If only a single date is needed, set start and end to the same date.",
      input_schema: {
        type: "object",
        properties: {
          start: {
            type: "string",
            description: "Start date in ISO 8601 format (e.g. 2026-02-26)",
          },
          end: {
            type: "string",
            description: "End date in ISO 8601 format (e.g. 2026-02-28)",
          },
        },
        required: ["start", "end"],
      },
    },
    isWrite: false,
    category: "calendar",
    execute: async (input) => {
      const start = new Date(input.start as string);
      const end = new Date(input.end as string);
      if (start.toDateString() === end.toDateString()) {
        return await getCalendarEvents(start);
      }
      return await getMonthCalendarEvents(start, end);
    },
  },
  {
    schema: {
      name: "create_calendar_event",
      description: "Create a new calendar event.",
      input_schema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title" },
          date: {
            type: "string",
            description: "Event date/time in ISO 8601 format",
          },
          calendarDate: {
            type: "string",
            description: "Event day in YYYY-MM-DD format (optional)",
          },
          place: { type: "string", description: "Event location (optional)" },
          status: {
            type: "string",
            description: "Event status",
            enum: ["scheduled", "completed", "canceled"],
          },
          notifyBySlack: {
            type: "boolean",
            description:
              "Send a Slack notification before the event (optional, default false)",
          },
          notifyBeforeMinutes: {
            type: "number",
            description:
              "How many minutes before the event to send the Slack notification (optional, default 15)",
          },
          links: {
            type: "array",
            description: "Related links for the event (optional)",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Link label" },
                url: { type: "string", description: "Link URL" },
                icon: { type: "string", description: "Icon name (optional)" },
              },
              required: ["label", "url"],
            },
          },
        },
        required: ["title", "date"],
      },
    },
    isWrite: true,
    category: "calendar",
    execute: async (input) => {
      const rawLinks = (input.links as LinkInput) ?? [];
      const links = await Promise.all(
        rawLinks.map(async (link) => ({
          ...link,
          icon: link.icon ?? (await fetchFavicon(link.url)),
        })),
      );

      const result = await createCalendarEvent({
        title: input.title as string,
        date: new Date(input.date as string),
        calendarDate: input.calendarDate as string | undefined,
        isAllDay: false,
        kind: "manual",
        place: input.place as string | undefined,
        status:
          (input.status as "scheduled" | "completed" | "canceled") ??
          "scheduled",
        notifyBySlack: (input.notifyBySlack as boolean) ?? false,
        notifyBeforeMinutes: (input.notifyBeforeMinutes as number) ?? 15,
        links,
      } as Parameters<typeof createCalendarEvent>[0]);
      if (!result) throw new Error("Failed to create calendar event");
      return result;
    },
  },
  {
    schema: {
      name: "update_calendar_event",
      description: "Update an existing calendar event by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Event ID" },
          title: { type: "string", description: "New title (optional)" },
          date: {
            type: "string",
            description: "New date in ISO 8601 (optional)",
          },
          calendarDate: {
            type: "string",
            description: "New event day in YYYY-MM-DD format (optional)",
          },
          place: { type: "string", description: "New location (optional)" },
          status: {
            type: "string",
            description: "New status (optional)",
            enum: ["scheduled", "completed", "canceled"],
          },
          notifyBySlack: {
            type: "boolean",
            description: "Enable or disable Slack notification (optional)",
          },
          notifyBeforeMinutes: {
            type: "number",
            description: "Minutes before the event to notify (optional)",
          },
          links: {
            type: "array",
            description: "Replace event links (optional)",
            items: {
              type: "object",
              properties: {
                label: { type: "string", description: "Link label" },
                url: { type: "string", description: "Link URL" },
                icon: { type: "string", description: "Icon name (optional)" },
              },
              required: ["label", "url"],
            },
          },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "calendar",
    execute: async (input) => {
      const data: Record<string, unknown> = {};
      if (input.title) data.title = input.title;
      if (input.date) data.date = new Date(input.date as string);
      if (input.calendarDate) data.calendarDate = input.calendarDate;
      if (input.place) data.place = input.place;
      if (input.status) data.status = input.status;
      if (input.notifyBySlack !== undefined)
        data.notifyBySlack = input.notifyBySlack;
      if (input.notifyBeforeMinutes !== undefined)
        data.notifyBeforeMinutes = input.notifyBeforeMinutes;
      if (input.links !== undefined) {
        const rawLinks = input.links as LinkInput;
        data.links = await Promise.all(
          rawLinks.map(async (link) => ({
            ...link,
            icon: link.icon ?? (await fetchFavicon(link.url)),
          })),
        );
      }
      const result = await updateCalendarEvent({
        id: input.id as string,
        data,
      });
      if (!result) throw new Error("Calendar event not found");
      return result;
    },
  },
  {
    schema: {
      name: "delete_calendar_event",
      description: "Delete a calendar event by its ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Event ID to delete" },
        },
        required: ["id"],
      },
    },
    isWrite: true,
    category: "calendar",
    execute: async (input) => {
      const success = await deleteCalendarEvent(input.id as string);
      if (!success) throw new Error("Failed to delete calendar event");
      return { success: true };
    },
  },
];
