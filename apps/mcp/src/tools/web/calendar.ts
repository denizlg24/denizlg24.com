import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { type Api, action, defineActions, p, partial } from "../define";

const id = z.string().min(1).describe("Event _id");
const byId = z.object({ id });

const eventFields = {
  title: z.string().min(1),
  date: z.string().optional().describe("ISO datetime; default now"),
  endDate: z.string().nullable().optional().describe("ISO datetime"),
  calendarDate: z.string().optional().describe("YYYY-MM-DD; derived from date"),
  isAllDay: z.boolean().optional(),
  kind: z
    .enum(["manual", "meeting", "flight", "holiday", "birthday"])
    .optional(),
  place: z.string().optional(),
  links: z
    .array(
      z.object({
        label: z.string(),
        url: z.string(),
        icon: z.string().optional(),
      }),
    )
    .optional(),
  status: z.enum(["scheduled", "completed", "canceled"]).optional(),
  notifyBySlack: z.boolean().optional(),
  notifyBeforeMinutes: z.number().int().optional(),
};

export function registerWebCalendar(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_calendar_events",
    title: "Web: calendar events",
    description: "Calendar events; manual ones sync outbound to Google.",
    actions: {
      list: action({
        description: "Events of one date, or of a start..end range",
        input: z.object({
          date: z.string().optional().describe("ISO date"),
          start: z.string().optional().describe("ISO date; needs end"),
          end: z.string().optional().describe("ISO date; needs start"),
        }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/calendar", query),
      }),
      create: action({
        description: "Adds an event (title required)",
        input: z.object(eventFields),
        run: (body) => api.web.post("/api/admin/calendar", body),
      }),
      update: action({
        description: "Changes any field",
        input: z.object({ id, ...partial(eventFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/calendar/${id}`, body),
      }),
      delete: action({
        description: "Deletes an event",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/calendar/${id}`),
      }),
      countries: action({
        description: "Holiday country options",
        readOnly: true,
        run: () => api.web.get("/api/admin/calendar/countries"),
      }),
    },
  });

  defineActions(server, {
    name: "web_calendar_settings",
    title: "Web: calendar settings",
    description: "Calendar singleton settings.",
    actions: {
      get: action({
        description: "Current settings",
        readOnly: true,
        run: () => api.web.get("/api/admin/calendar/settings"),
      }),
      update: action({
        description: "Sets the holiday country; empty clears it",
        input: z.object({ holidayCountryCode: z.string().nullable() }),
        idempotent: true,
        run: (body) => api.web.patch("/api/admin/calendar/settings", body),
      }),
    },
  });

  defineActions(server, {
    name: "web_calendar_google",
    title: "Web: Google Calendar",
    description: "Google Calendar connection and sync.",
    actions: {
      status: action({
        description: "Connection, sync state and pending items",
        readOnly: true,
        run: () => api.web.get("/api/admin/calendar/google"),
      }),
      connect: action({
        description: "Returns the OAuth authorization URL to open in a browser",
        run: () => api.web.post("/api/admin/calendar/google/connect"),
      }),
      update: action({
        description: "Toggles sync or changes the target calendarId",
        input: z.object({
          enabled: z.boolean().optional(),
          calendarId: z.string().trim().min(1).max(255).optional(),
        }),
        idempotent: true,
        run: (body) => api.web.patch("/api/admin/calendar/google", body),
      }),
      disconnect: action({
        description: "Revokes the connection",
        destructive: true,
        run: () => api.web.delete("/api/admin/calendar/google"),
      }),
      sync: action({
        description: "Runs a sync, optionally bounded to start..end",
        input: z.object({
          start: z.iso.datetime().optional(),
          end: z.iso.datetime().optional(),
        }),
        run: (body) => api.web.post("/api/admin/calendar/google/sync", body),
      }),
      retry: action({
        description: "Retries failed outbound syncs",
        run: () => api.web.post("/api/admin/calendar/google/retry"),
      }),
    },
  });
}
