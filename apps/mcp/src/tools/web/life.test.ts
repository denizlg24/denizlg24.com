import { describe, expect, test } from "bun:test";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import { createClient, recordingUpstream } from "../harness.test-util";
import { registerWebCalendar } from "./calendar";
import { registerWebKanban } from "./kanban";
import { registerWebNotes } from "./notes";
import { registerWebPeople } from "./people";
import { registerWebPlanning } from "./planning";
import { registerWebResources } from "./resources";

const register: ToolRegistrar = (server, upstream) => {
  const api = createApi(upstream);
  registerWebPeople(server, api);
  registerWebResources(server, api);
  registerWebKanban(server, api);
  registerWebNotes(server, api);
  registerWebCalendar(server, api);
  registerWebPlanning(server, api);
};

function setup() {
  const { upstream, calls } = recordingUpstream();
  const client = createClient(upstream, register);
  const last = () => {
    const call = calls.at(-1);
    if (!call) throw new Error("no upstream call recorded");
    return {
      method: call.method,
      path: call.path,
      body: call.body === null ? null : JSON.parse(call.body),
    };
  };
  return { client, calls, last };
}

describe("life tools", () => {
  test("registers exactly the life tool names", async () => {
    const { client } = setup();
    const names = (await client.listTools()).map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        "web_people",
        "web_people_groups",
        "web_resources",
        "web_resource_services",
        "web_resource_capabilities",
        "web_picron_jobs",
        "web_sub_resources",
        "web_kanban_boards",
        "web_kanban_columns",
        "web_kanban_cards",
        "web_notes",
        "web_note_edges",
        "web_note_groups",
        "web_calendar_events",
        "web_calendar_settings",
        "web_calendar_google",
        "web_timetable",
        "web_journal",
        "web_whiteboards",
      ].sort(),
    );
  });
});

describe("web_people", () => {
  test("routes every action", async () => {
    const { client, last } = setup();
    await client.call("web_people", { action: "list" });
    expect(last()).toMatchObject({ method: "GET", path: "/api/admin/people" });
    await client.call("web_people", { action: "get", id: "p 1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/people/p%201",
    });
    await client.call("web_people", {
      action: "create",
      name: "Ana",
      birthday: { month: 3, day: 9 },
      relations: [{ personId: "p2", reason: "sister" }],
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/people",
      body: {
        name: "Ana",
        birthday: { month: 3, day: 9 },
        relations: [{ personId: "p2", reason: "sister" }],
      },
    });
    await client.call("web_people", {
      action: "update",
      id: "p1",
      birthday: null,
      email: "a@b.c",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/people/p1",
      body: { birthday: null, email: "a@b.c" },
    });
    await client.call("web_people", { action: "delete", id: "p1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/people/p1",
    });
  });

  test("groups", async () => {
    const { client, last } = setup();
    await client.call("web_people_groups", { action: "list" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/people/groups",
    });
    await client.call("web_people_groups", {
      action: "create",
      name: "Family",
      parentId: "g0",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/people/groups",
      body: { name: "Family", parentId: "g0" },
    });
    await client.call("web_people_groups", {
      action: "update",
      id: "g1",
      parentId: null,
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/people/groups/g1",
      body: { parentId: null },
    });
    await client.call("web_people_groups", { action: "delete", id: "g1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/people/groups/g1",
    });
  });
});

describe("web_resources", () => {
  test("resources", async () => {
    const { client, last } = setup();
    await client.call("web_resources", { action: "list" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/resources",
    });
    await client.call("web_resources", { action: "get", id: "r1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/resources/r1",
    });
    await client.call("web_resources", {
      action: "create",
      name: "pi",
      url: "https://pi",
      type: "pi",
      agentService: { enabled: true, nodeId: "n1", hmacSecret: "s" },
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/resources",
      body: {
        name: "pi",
        url: "https://pi",
        type: "pi",
        agentService: { enabled: true, nodeId: "n1", hmacSecret: "s" },
      },
    });
    await client.call("web_resources", {
      action: "update",
      id: "r1",
      isPublic: false,
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/resources/r1",
      body: { isPublic: false },
    });
    await client.call("web_resources", { action: "delete", id: "r1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/resources/r1",
    });
    await client.call("web_resources", { action: "reboot", id: "r1" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/resources/r1/reboot",
    });
    await client.call("web_resources", { action: "health_check" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/resources/health-check",
    });
  });

  test("services", async () => {
    const { client, last } = setup();
    await client.call("web_resource_services", { action: "list", id: "r1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/resources/r1/services",
    });
    await client.call("web_resource_services", {
      action: "restart",
      id: "r1",
      serviceName: "nginx",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/resources/r1/services",
      body: { serviceName: "nginx" },
    });
  });

  test("capabilities", async () => {
    const { client, last } = setup();
    await client.call("web_resource_capabilities", {
      action: "create",
      id: "r1",
      type: "picron",
      label: "cron",
      baseUrl: "http://pi:9000",
      username: "u",
      password: "p",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/resources/r1/capabilities",
      body: {
        type: "picron",
        label: "cron",
        baseUrl: "http://pi:9000",
        username: "u",
        password: "p",
      },
    });
    await client.call("web_resource_capabilities", {
      action: "update",
      id: "r1",
      capId: "c1",
      isActive: false,
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/resources/r1/capabilities/c1",
      body: { isActive: false },
    });
    await client.call("web_resource_capabilities", {
      action: "delete",
      id: "r1",
      capId: "c1",
    });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/resources/r1/capabilities/c1",
    });
  });

  test("picron jobs", async () => {
    const { client, last } = setup();
    const base = "/api/admin/resources/r1/capabilities/c1/picron";
    await client.call("web_picron_jobs", {
      action: "list",
      id: "r1",
      capId: "c1",
    });
    expect(last()).toMatchObject({ method: "GET", path: `${base}/jobs` });
    await client.call("web_picron_jobs", {
      action: "create",
      id: "r1",
      capId: "c1",
      name: "ping",
      expression: "* * * * *",
      url: "https://x.y/z",
      method: "GET",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: `${base}/jobs`,
      body: {
        name: "ping",
        expression: "* * * * *",
        url: "https://x.y/z",
        method: "GET",
      },
    });
    await client.call("web_picron_jobs", {
      action: "update",
      id: "r1",
      capId: "c1",
      jobId: "j1",
      enabled: false,
    });
    expect(last()).toMatchObject({
      method: "PUT",
      path: `${base}/jobs/j1`,
      body: { enabled: false },
    });
    await client.call("web_picron_jobs", {
      action: "delete",
      id: "r1",
      capId: "c1",
      jobId: "j1",
    });
    expect(last()).toMatchObject({ method: "DELETE", path: `${base}/jobs/j1` });
    await client.call("web_picron_jobs", {
      action: "trigger",
      id: "r1",
      capId: "c1",
      jobId: "j1",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: `${base}/jobs/j1/trigger`,
    });
    await client.call("web_picron_jobs", {
      action: "history",
      id: "r1",
      capId: "c1",
      jobId: "j1",
    });
    expect(last()).toMatchObject({
      method: "GET",
      path: `${base}/jobs/j1/history`,
    });
    await client.call("web_picron_jobs", {
      action: "stats",
      id: "r1",
      capId: "c1",
    });
    expect(last()).toMatchObject({ method: "GET", path: `${base}/stats` });
  });

  test("sub-resources", async () => {
    const { client, last } = setup();
    await client.call("web_sub_resources", { action: "list", id: "r1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/resources/r1/sub-resources",
    });
    await client.call("web_sub_resources", {
      action: "create",
      id: "r1",
      name: "redis",
      check: { type: "tcp", host: "pi", port: 6380 },
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/resources/r1/sub-resources",
      body: { name: "redis", check: { type: "tcp", host: "pi", port: 6380 } },
    });
    await client.call("web_sub_resources", {
      action: "update",
      id: "r1",
      subId: "s1",
      check: { type: "http", url: "https://x/healthz", expectStatus: 200 },
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/resources/r1/sub-resources/s1",
      body: {
        check: { type: "http", url: "https://x/healthz", expectStatus: 200 },
      },
    });
    await client.call("web_sub_resources", {
      action: "delete",
      id: "r1",
      subId: "s1",
    });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/resources/r1/sub-resources/s1",
    });
  });
});

describe("web_kanban", () => {
  test("boards", async () => {
    const { client, last } = setup();
    await client.call("web_kanban_boards", { action: "list" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/kanban/boards",
    });
    await client.call("web_kanban_boards", { action: "get", boardId: "b1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/kanban/boards/b1",
    });
    await client.call("web_kanban_boards", { action: "create", title: "Work" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/kanban/boards",
      body: { title: "Work" },
    });
    await client.call("web_kanban_boards", {
      action: "update",
      boardId: "b1",
      isArchived: true,
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/kanban/boards/b1",
      body: { isArchived: true },
    });
    await client.call("web_kanban_boards", { action: "delete", boardId: "b1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/kanban/boards/b1",
    });
    await client.call("web_kanban_boards", { action: "upcoming", days: 14 });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/kanban/upcoming?days=14",
    });
  });

  test("columns", async () => {
    const { client, last } = setup();
    const base = "/api/admin/kanban/boards/b1/columns";
    await client.call("web_kanban_columns", { action: "list", boardId: "b1" });
    expect(last()).toMatchObject({ method: "GET", path: base });
    await client.call("web_kanban_columns", {
      action: "create",
      boardId: "b1",
      title: "Doing",
      wipLimit: 3,
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: base,
      body: { title: "Doing", wipLimit: 3 },
    });
    await client.call("web_kanban_columns", {
      action: "update",
      boardId: "b1",
      columnId: "c1",
      sortRule: "priority",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: `${base}/c1`,
      body: { sortRule: "priority" },
    });
    await client.call("web_kanban_columns", {
      action: "delete",
      boardId: "b1",
      columnId: "c1",
    });
    expect(last()).toMatchObject({ method: "DELETE", path: `${base}/c1` });
    await client.call("web_kanban_columns", {
      action: "reorder",
      boardId: "b1",
      items: [{ _id: "c1", order: 0 }],
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: `${base}/reorder`,
      body: { items: [{ _id: "c1", order: 0 }] },
    });
    await client.call("web_kanban_columns", {
      action: "clear",
      boardId: "b1",
      columnId: "c1",
    });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: `${base}/c1/cards`,
    });
  });

  test("cards", async () => {
    const { client, last } = setup();
    const base = "/api/admin/kanban/boards/b1/cards";
    await client.call("web_kanban_cards", {
      action: "list",
      boardId: "b1",
      columnId: "c1",
    });
    expect(last()).toMatchObject({
      method: "GET",
      path: `${base}?columnId=c1`,
    });
    await client.call("web_kanban_cards", {
      action: "get",
      boardId: "b1",
      cardId: "k1",
    });
    expect(last()).toMatchObject({ method: "GET", path: `${base}/k1` });
    await client.call("web_kanban_cards", {
      action: "create",
      boardId: "b1",
      columnId: "c1",
      title: "Ship",
      priority: "high",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: base,
      body: { columnId: "c1", title: "Ship", priority: "high" },
    });
    await client.call("web_kanban_cards", {
      action: "update",
      boardId: "b1",
      cardId: "k1",
      columnId: "c2",
      dueDate: null,
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: `${base}/k1`,
      body: { columnId: "c2", dueDate: null },
    });
    await client.call("web_kanban_cards", {
      action: "delete",
      boardId: "b1",
      cardId: "k1",
    });
    expect(last()).toMatchObject({ method: "DELETE", path: `${base}/k1` });
    await client.call("web_kanban_cards", {
      action: "reorder",
      boardId: "b1",
      items: [{ _id: "k1", columnId: "c1", order: 2 }],
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: `${base}/reorder`,
      body: { items: [{ _id: "k1", columnId: "c1", order: 2 }] },
    });
    await client.call("web_kanban_cards", {
      action: "link",
      boardId: "b1",
      cardId: "k1",
      entityType: "note",
      entityId: "n1",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: `${base}/k1/links`,
      body: { entityType: "note", entityId: "n1" },
    });
    await client.call("web_kanban_cards", {
      action: "unlink",
      boardId: "b1",
      cardId: "k1",
      entityType: "note",
      entityId: "n1",
    });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: `${base}/k1/links?entityType=note&entityId=n1`,
      body: null,
    });
  });
});

describe("web_notes", () => {
  test("notes", async () => {
    const { client, last } = setup();
    await client.call("web_notes", { action: "list" });
    expect(last()).toMatchObject({ method: "GET", path: "/api/admin/notes" });
    await client.call("web_notes", { action: "get", noteId: "n1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/notes/n1",
    });
    await client.call("web_notes", {
      action: "create",
      url: "https://x.y",
      skipMetadataFetch: true,
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/notes",
      body: { url: "https://x.y", skipMetadataFetch: true },
    });
    await client.call("web_notes", {
      action: "update",
      noteId: "n1",
      status: "archived",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/notes/n1",
      body: { status: "archived" },
    });
    await client.call("web_notes", {
      action: "replace",
      noteId: "n1",
      content: "# hi",
    });
    expect(last()).toMatchObject({
      method: "PUT",
      path: "/api/admin/notes/n1",
      body: { content: "# hi" },
    });
    await client.call("web_notes", { action: "delete", noteId: "n1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/notes/n1",
    });
    await client.call("web_notes", {
      action: "rename",
      noteId: "n1",
      name: "New",
    });
    expect(last()).toMatchObject({
      method: "PUT",
      path: "/api/admin/notes/n1/name",
      body: { name: "New" },
    });
    await client.call("web_notes", {
      action: "categorize",
      noteId: "n1",
      title: "T",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/notes/n1/categorize",
      body: { title: "T" },
    });
    await client.call("web_notes", { action: "tags" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/notes/tags",
    });
  });

  test("export returns the markdown body", async () => {
    const { upstream, calls } = recordingUpstream(
      () =>
        new Response("# note", {
          headers: { "content-type": "text/markdown" },
        }),
    );
    const client = createClient(upstream, register);
    const result = await client.call("web_notes", {
      action: "export",
      noteId: "n1",
    });
    expect(calls.at(-1)).toMatchObject({
      method: "GET",
      path: "/api/admin/notes/n1/download",
    });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ data: "# note" });
  });

  test("edges and groups", async () => {
    const { client, last } = setup();
    await client.call("web_note_edges", {
      action: "create",
      from: "n1",
      to: "n2",
      reason: "same topic",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/notes/edges",
      body: { from: "n1", to: "n2", reason: "same topic" },
    });
    await client.call("web_note_edges", { action: "delete", edgeId: "e1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/notes/edges/e1",
    });
    await client.call("web_note_groups", { action: "list" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/note-groups",
    });
    await client.call("web_note_groups", { action: "create", name: "Read" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/note-groups",
      body: { name: "Read" },
    });
    await client.call("web_note_groups", {
      action: "update",
      id: "g1",
      color: "#fff",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/note-groups/g1",
      body: { color: "#fff" },
    });
    await client.call("web_note_groups", { action: "delete", id: "g1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/note-groups/g1",
    });
  });
});

describe("web_calendar", () => {
  test("events", async () => {
    const { client, last } = setup();
    await client.call("web_calendar_events", {
      action: "list",
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/calendar?start=2026-09-01&end=2026-09-30",
    });
    await client.call("web_calendar_events", {
      action: "list",
      date: "2026-09-13",
    });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/calendar?date=2026-09-13",
    });
    await client.call("web_calendar_events", {
      action: "create",
      title: "Dentist",
      date: "2026-09-14T09:00:00Z",
      kind: "meeting",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/calendar",
      body: { title: "Dentist", date: "2026-09-14T09:00:00Z", kind: "meeting" },
    });
    await client.call("web_calendar_events", {
      action: "update",
      id: "e1",
      status: "completed",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/calendar/e1",
      body: { status: "completed" },
    });
    await client.call("web_calendar_events", { action: "delete", id: "e1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/calendar/e1",
    });
    await client.call("web_calendar_events", { action: "countries" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/calendar/countries",
    });
  });

  test("settings", async () => {
    const { client, last } = setup();
    await client.call("web_calendar_settings", { action: "get" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/calendar/settings",
    });
    await client.call("web_calendar_settings", {
      action: "update",
      holidayCountryCode: "pt",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/calendar/settings",
      body: { holidayCountryCode: "pt" },
    });
  });

  test("google", async () => {
    const { client, last } = setup();
    await client.call("web_calendar_google", { action: "status" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/calendar/google",
    });
    await client.call("web_calendar_google", { action: "connect" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/calendar/google/connect",
    });
    await client.call("web_calendar_google", {
      action: "update",
      enabled: true,
      calendarId: "primary",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/calendar/google",
      body: { enabled: true, calendarId: "primary" },
    });
    await client.call("web_calendar_google", { action: "disconnect" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/calendar/google",
    });
    await client.call("web_calendar_google", {
      action: "sync",
      start: "2026-09-01T00:00:00Z",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/calendar/google/sync",
      body: { start: "2026-09-01T00:00:00Z" },
    });
    await client.call("web_calendar_google", { action: "retry" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/calendar/google/retry",
    });
  });
});

describe("web_planning", () => {
  test("timetable", async () => {
    const { client, last } = setup();
    await client.call("web_timetable", { action: "list" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/timetable",
    });
    await client.call("web_timetable", { action: "get", id: "t1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/timetable/t1",
    });
    await client.call("web_timetable", {
      action: "create",
      title: "Gym",
      dayOfWeek: 1,
      startTime: "07:00",
      endTime: "08:00",
      color: "accent",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/timetable",
      body: {
        title: "Gym",
        dayOfWeek: 1,
        startTime: "07:00",
        endTime: "08:00",
        color: "accent",
      },
    });
    await client.call("web_timetable", {
      action: "update",
      id: "t1",
      isActive: false,
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/timetable/t1",
      body: { isActive: false },
    });
    await client.call("web_timetable", { action: "delete", id: "t1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/timetable/t1",
    });
  });

  test("journal", async () => {
    const { client, last } = setup();
    await client.call("web_journal", {
      action: "list",
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/journal?start=2026-09-01&end=2026-09-30",
    });
    await client.call("web_journal", { action: "get", id: "j1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/journal/j1",
    });
    await client.call("web_journal", {
      action: "create",
      date: "2026-09-13",
      content: "day",
    });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/journal",
      body: { date: "2026-09-13", content: "day" },
    });
    await client.call("web_journal", {
      action: "update",
      id: "j1",
      content: "night",
    });
    expect(last()).toMatchObject({
      method: "PATCH",
      path: "/api/admin/journal/j1",
      body: { content: "night" },
    });
    await client.call("web_journal", { action: "delete", id: "j1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/journal/j1",
    });
  });

  test("whiteboards", async () => {
    const { client, last } = setup();
    await client.call("web_whiteboards", { action: "list" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/whiteboard",
    });
    await client.call("web_whiteboards", { action: "get", id: "w1" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/whiteboard/w1",
    });
    await client.call("web_whiteboards", { action: "create", name: "Ideas" });
    expect(last()).toMatchObject({
      method: "POST",
      path: "/api/admin/whiteboard",
      body: { name: "Ideas" },
    });
    await client.call("web_whiteboards", {
      action: "replace",
      id: "w1",
      viewState: { x: 0, y: 0, zoom: 1 },
      order: 2,
    });
    expect(last()).toMatchObject({
      method: "PUT",
      path: "/api/admin/whiteboard/w1",
      body: { viewState: { x: 0, y: 0, zoom: 1 }, order: 2 },
    });
    await client.call("web_whiteboards", { action: "delete", id: "w1" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/whiteboard/w1",
    });
    await client.call("web_whiteboards", { action: "today_get" });
    expect(last()).toMatchObject({
      method: "GET",
      path: "/api/admin/whiteboard/today",
    });
    await client.call("web_whiteboards", {
      action: "today_replace",
      background: { color: "#fff", pattern: "dots" },
    });
    expect(last()).toMatchObject({
      method: "PUT",
      path: "/api/admin/whiteboard/today",
      body: { background: { color: "#fff", pattern: "dots" } },
    });
    await client.call("web_whiteboards", { action: "today_delete" });
    expect(last()).toMatchObject({
      method: "DELETE",
      path: "/api/admin/whiteboard/today",
    });
  });
});
