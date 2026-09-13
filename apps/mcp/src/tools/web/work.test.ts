import { beforeEach, describe, expect, test } from "bun:test";
import type { ToolRegistrar } from "../../server";
import { createApi } from "../define";
import {
  createClient,
  type RecordedCall,
  recordingUpstream,
} from "../harness.test-util";
import { registerWebAgentTasks } from "./agent-tasks";
import { registerWebBackgroundAgent } from "./background-agent";
import { registerWebConversations } from "./conversations";
import { registerWebCourses } from "./courses";
import { registerWebCv } from "./cv";
import { registerWebEmail } from "./email";
import { registerWebLatex } from "./latex";
import { registerWebLlm } from "./llm";
import { registerWebPapers } from "./papers";
import { registerWebSpreadsheets } from "./spreadsheets";
import { registerWebTriage } from "./triage";
import { registerWebVoiceNotes } from "./voice-notes";

const register: ToolRegistrar = (server, upstream) => {
  const api = createApi(upstream);
  registerWebCourses(server, api);
  registerWebPapers(server, api);
  registerWebSpreadsheets(server, api);
  registerWebEmail(server, api);
  registerWebTriage(server, api);
  registerWebConversations(server, api);
  registerWebAgentTasks(server, api);
  registerWebBackgroundAgent(server, api);
  registerWebVoiceNotes(server, api);
  registerWebCv(server, api);
  registerWebLatex(server, api);
  registerWebLlm(server, api);
};

const { upstream, calls } = recordingUpstream();
const client = createClient(upstream, register);

function last(): RecordedCall {
  const call = calls.at(-1);
  if (!call) throw new Error("no upstream call recorded");
  return call;
}

function lastJson(): Record<string, unknown> {
  return JSON.parse(last().body ?? "null") as Record<string, unknown>;
}

async function expectCall(
  name: string,
  args: Record<string, unknown>,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  const before = calls.length;
  const result = await client.call(name, args);
  expect(result.isError).toBeFalsy();
  expect(calls.length).toBe(before + 1);
  expect(last().method).toBe(method);
  expect(last().path).toBe(path);
  if (body !== undefined) expect(lastJson()).toEqual(body);
}

beforeEach(() => {
  calls.length = 0;
});

function z64(text: string) {
  return Buffer.from(text, "utf8").toString("base64");
}
const tiny = z64("hello");

const latexProject = {
  version: 1,
  name: "CV",
  mainFile: "main.tex",
  entries: [
    {
      id: "0b7e2b7a-1f7c-4a1e-9a6b-2f3e4d5c6b7a",
      path: "main.tex",
      kind: "file",
      encoding: "utf8",
      content: "\\documentclass{article}",
    },
  ],
};

describe("work group registry", () => {
  test("lists exactly the group's tools", async () => {
    const names = (await client.listTools()).map((tool) => tool.name).sort();
    expect(names).toEqual(
      [
        "web_courses",
        "web_course_assignments",
        "web_course_emails",
        "web_papers",
        "web_spreadsheets",
        "web_email_accounts",
        "web_emails",
        "web_triage",
        "web_triage_settings",
        "web_conversations",
        "web_agent_tasks",
        "web_background_agent_runs",
        "web_voice_notes",
        "web_cv",
        "web_latex_projects",
        "web_latex_agent",
        "web_latex_history",
        "web_latex_references",
        "web_llm",
      ].sort(),
    );
  });
});

describe("web_courses", () => {
  test("routes", async () => {
    await expectCall(
      "web_courses",
      { action: "overview" },
      "GET",
      "/api/admin/courses/overview",
    );
    await expectCall(
      "web_courses",
      { action: "options" },
      "GET",
      "/api/admin/courses/options",
    );
    await expectCall(
      "web_courses",
      { action: "list" },
      "GET",
      "/api/admin/courses",
    );
    await expectCall(
      "web_courses",
      { action: "get", id: "c 1" },
      "GET",
      "/api/admin/courses/c%201",
    );
    await expectCall(
      "web_courses",
      { action: "create", name: "Algo", links: [{ label: "x", url: "u" }] },
      "POST",
      "/api/admin/courses",
      { name: "Algo", links: [{ label: "x", url: "u" }] },
    );
    await expectCall(
      "web_courses",
      { action: "update", id: "c1", status: "archived" },
      "PATCH",
      "/api/admin/courses/c1",
      { status: "archived" },
    );
    await expectCall(
      "web_courses",
      { action: "delete", id: "c1" },
      "DELETE",
      "/api/admin/courses/c1",
    );
  });
});

describe("web_course_assignments", () => {
  test("routes", async () => {
    await expectCall(
      "web_course_assignments",
      { action: "list", id: "c1" },
      "GET",
      "/api/admin/courses/c1/assignments",
    );
    await expectCall(
      "web_course_assignments",
      { action: "create", id: "c1", title: "HW1", type: "exam" },
      "POST",
      "/api/admin/courses/c1/assignments",
      { title: "HW1", type: "exam" },
    );
    await expectCall(
      "web_course_assignments",
      { action: "update", id: "c1", assignmentId: "a1", status: "graded" },
      "PATCH",
      "/api/admin/courses/c1/assignments/a1",
      { status: "graded" },
    );
    await expectCall(
      "web_course_assignments",
      { action: "delete", id: "c1", assignmentId: "a1" },
      "DELETE",
      "/api/admin/courses/c1/assignments/a1",
    );
  });
});

describe("web_course_emails", () => {
  test("routes", async () => {
    await expectCall(
      "web_course_emails",
      { action: "list", id: "c1", page: 2, pageSize: 10, q: "exam" },
      "GET",
      "/api/admin/courses/c1/emails?page=2&pageSize=10&q=exam",
    );
    await expectCall(
      "web_course_emails",
      { action: "update", id: "c1", triageIds: ["t1"], courseId: null },
      "PATCH",
      "/api/admin/courses/c1/emails",
      { triageIds: ["t1"], courseId: null },
    );
  });
});

describe("web_papers", () => {
  test("routes", async () => {
    await expectCall(
      "web_papers",
      { action: "list", courseId: "c1" },
      "GET",
      "/api/admin/papers?courseId=c1",
    );
    await expectCall(
      "web_papers",
      { action: "get", paperId: "p1" },
      "GET",
      "/api/admin/papers/p1",
    );
    await expectCall(
      "web_papers",
      { action: "create", title: "T", year: null },
      "POST",
      "/api/admin/papers",
      { title: "T" },
    );
    await expectCall(
      "web_papers",
      { action: "update", paperId: "p1", year: null },
      "PATCH",
      "/api/admin/papers/p1",
      { year: null },
    );
    await expectCall(
      "web_papers",
      { action: "update", paperId: "p1", readingStatus: "read" },
      "PATCH",
      "/api/admin/papers/p1",
      { readingStatus: "read" },
    );
    await expectCall(
      "web_papers",
      { action: "delete", paperId: "p1" },
      "DELETE",
      "/api/admin/papers/p1",
    );
    await expectCall(
      "web_papers",
      { action: "resolve", identifier: "10.1/x" },
      "POST",
      "/api/admin/papers/resolve",
      { identifier: "10.1/x", kind: "academic" },
    );
    await expectCall(
      "web_papers",
      { action: "progress_set", paperId: "p1", currentPage: 3, totalPages: 9 },
      "PUT",
      "/api/admin/papers/p1/progress",
      { currentPage: 3, totalPages: 9 },
    );
    await expectCall(
      "web_papers",
      { action: "progress_update", paperId: "p1", totalPages: 9 },
      "PATCH",
      "/api/admin/papers/p1/progress",
      { totalPages: 9 },
    );
    await expectCall(
      "web_papers",
      { action: "unlink_course", paperId: "p1", courseId: "c1" },
      "DELETE",
      "/api/admin/papers/p1/courses/c1",
    );
  });

  test("upload sends the raw PDF with the filename header", async () => {
    await client.call("web_papers", {
      action: "upload",
      filename: "a b.pdf",
      base64: z64("%PDF-1.4"),
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/papers/upload");
    expect(last().headers["x-upload-filename"]).toBe("a%20b.pdf");
    expect(last().headers["content-type"]).toBe("application/pdf");
  });
});

describe("web_spreadsheets", () => {
  test("routes", async () => {
    await expectCall(
      "web_spreadsheets",
      { action: "list" },
      "GET",
      "/api/admin/spreadsheets",
    );
    await expectCall(
      "web_spreadsheets",
      { action: "get", id: "s1" },
      "GET",
      "/api/admin/spreadsheets/s1",
    );
    await expectCall(
      "web_spreadsheets",
      { action: "create", title: "Budget", tags: ["x"] },
      "POST",
      "/api/admin/spreadsheets",
      { title: "Budget", tags: ["x"] },
    );
    await expectCall(
      "web_spreadsheets",
      { action: "update", id: "s1", description: "d" },
      "PATCH",
      "/api/admin/spreadsheets/s1",
      { description: "d" },
    );
    await expectCall(
      "web_spreadsheets",
      { action: "delete", id: "s1" },
      "DELETE",
      "/api/admin/spreadsheets/s1",
    );
  });

  test("import posts multipart", async () => {
    await client.call("web_spreadsheets", {
      action: "import",
      filename: "a.csv",
      text: "a,b\n1,2",
      title: "T",
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/spreadsheets/import");
    expect(last().body).toBe("[object FormData]");
  });

  test("import refuses text and base64 together", async () => {
    const result = await client.call("web_spreadsheets", {
      action: "import",
      filename: "a.csv",
      text: "x",
      base64: tiny,
    });
    expect(result.isError).toBe(true);
    expect(calls.length).toBe(0);
  });
});

describe("web_email_accounts", () => {
  test("routes", async () => {
    await expectCall(
      "web_email_accounts",
      { action: "list" },
      "GET",
      "/api/admin/email-accounts",
    );
    await expectCall(
      "web_email_accounts",
      { action: "create", user: "a@b.co", password: "pw", provider: "gmail" },
      "POST",
      "/api/admin/email-accounts",
      { user: "a@b.co", password: "pw", provider: "gmail" },
    );
    await expectCall(
      "web_email_accounts",
      { action: "update", id: "e1", smtpEnabled: true },
      "PATCH",
      "/api/admin/email-accounts/e1",
      { smtpEnabled: true },
    );
    await expectCall(
      "web_email_accounts",
      { action: "delete", id: "e1" },
      "DELETE",
      "/api/admin/email-accounts/e1",
    );
    await expectCall(
      "web_email_accounts",
      { action: "sync", id: "e1" },
      "POST",
      "/api/admin/email-accounts/e1/sync",
    );
    await expectCall(
      "web_email_accounts",
      { action: "sync_all" },
      "POST",
      "/api/admin/email-accounts/sync",
    );
  });
});

describe("web_emails", () => {
  test("routes", async () => {
    await expectCall(
      "web_emails",
      { action: "list", id: "e1", page: 2, limit: 5, search: "hi" },
      "GET",
      "/api/admin/email-accounts/e1/emails?page=2&limit=5&search=hi",
    );
    await expectCall(
      "web_emails",
      { action: "get", id: "e1", emailId: "m1" },
      "GET",
      "/api/admin/email-accounts/e1/emails/m1",
    );
    await expectCall(
      "web_emails",
      { action: "attachments", id: "e1", emailId: "m1" },
      "GET",
      "/api/admin/email-accounts/e1/emails/m1/attachments",
    );
    await expectCall(
      "web_emails",
      { action: "send", id: "e1", to: ["x@y.co"], text: "hi" },
      "POST",
      "/api/admin/email-accounts/e1/send",
      { to: ["x@y.co"], text: "hi" },
    );
  });
});

describe("web_triage", () => {
  test("routes", async () => {
    await expectCall(
      "web_triage",
      { action: "list", category: "course", reviewRequired: true, limit: 5 },
      "GET",
      "/api/admin/triage?category=course&reviewRequired=true&limit=5",
    );
    await expectCall(
      "web_triage",
      { action: "get", id: "t1" },
      "GET",
      "/api/admin/triage/t1",
    );
    await expectCall(
      "web_triage",
      { action: "update", id: "t1", userStatus: "reviewed" },
      "PATCH",
      "/api/admin/triage/t1",
      { userStatus: "reviewed" },
    );
    await expectCall(
      "web_triage",
      {
        action: "suggestion_update",
        id: "t1",
        suggestionId: "s1",
        type: "task",
        decision: "accept",
        overrides: { title: "x" },
      },
      "PATCH",
      "/api/admin/triage/t1/suggestions/s1",
      { type: "task", action: "accept", overrides: { title: "x" } },
    );
    await expectCall(
      "web_triage",
      { action: "warm_bodies", triageIds: ["t1"] },
      "POST",
      "/api/admin/triage/bodies",
      { triageIds: ["t1"] },
    );
    await expectCall(
      "web_triage",
      { action: "run", since: "2026-01-01T00:00:00.000Z" },
      "POST",
      "/api/admin/triage/run",
      { since: "2026-01-01T00:00:00.000Z" },
    );
  });

  test("archive sends a valid category", async () => {
    const before = calls.length;
    const result = await client.call("web_triage", {
      action: "archive",
      category: "nonsense",
    });
    expect(result.isError).toBe(true);
    expect(calls.length).toBe(before);
  });
});

describe("web_triage_settings", () => {
  test("routes", async () => {
    await expectCall(
      "web_triage_settings",
      { action: "get" },
      "GET",
      "/api/admin/triage/settings",
    );
    await expectCall(
      "web_triage_settings",
      { action: "update", enabled: false, runIntervalMinutes: 30 },
      "PATCH",
      "/api/admin/triage/settings",
      { enabled: false, runIntervalMinutes: 30 },
    );
  });
});

describe("web_conversations", () => {
  test("routes", async () => {
    await expectCall(
      "web_conversations",
      { action: "list", offset: 10, limit: 5, cursor: "c" },
      "GET",
      "/api/admin/conversations?offset=10&limit=5&cursor=c",
    );
    await expectCall(
      "web_conversations",
      { action: "get", conversationId: "v1" },
      "GET",
      "/api/admin/conversations/v1",
    );
    await expectCall(
      "web_conversations",
      { action: "create", title: "T", model: "anthropic/claude-haiku-4.5" },
      "POST",
      "/api/admin/conversations",
      { title: "T", model: "anthropic/claude-haiku-4.5" },
    );
    await expectCall(
      "web_conversations",
      { action: "update", conversationId: "v1", memoryMode: "incognito" },
      "PATCH",
      "/api/admin/conversations/v1",
      { memoryMode: "incognito" },
    );
    await expectCall(
      "web_conversations",
      { action: "delete", conversationId: "v1" },
      "DELETE",
      "/api/admin/conversations/v1",
    );
  });
});

describe("web_agent_tasks", () => {
  test("routes", async () => {
    await expectCall(
      "web_agent_tasks",
      { action: "list" },
      "GET",
      "/api/admin/agent-tasks",
    );
    const created = await client.call("web_agent_tasks", {
      action: "create",
      name: "Daily",
      prompt: "do it",
      schedule: { cron: "0 9 * * *", timeZone: "Europe/Lisbon" },
    });
    expect(created.isError).toBeFalsy();
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/agent-tasks");
    expect(lastJson()).toEqual({
      name: "Daily",
      prompt: "do it",
      schedule: { cron: "0 9 * * *", timeZone: "Europe/Lisbon" },
      attachments: [],
      memoryMode: "enabled",
      origin: "agent",
    });
    await expectCall(
      "web_agent_tasks",
      { action: "update", taskId: "k1", status: "paused" },
      "PATCH",
      "/api/admin/agent-tasks/k1",
      { status: "paused" },
    );
    await expectCall(
      "web_agent_tasks",
      { action: "delete", taskId: "k1" },
      "DELETE",
      "/api/admin/agent-tasks/k1",
    );
    await expectCall(
      "web_agent_tasks",
      { action: "run", taskId: "k1" },
      "POST",
      "/api/admin/agent-tasks/k1/run",
    );
    await expectCall(
      "web_agent_tasks",
      { action: "cron_preview", cron: "0 9 * * *", timeZone: "UTC" },
      "GET",
      "/api/admin/agent-tasks/cron-preview?cron=0+9+*+*+*&timeZone=UTC",
    );
    await expectCall(
      "web_agent_tasks",
      {
        action: "run_feedback",
        runId: "r1",
        feedbackId: "0b7e2b7a-1f7c-4a1e-9a6b-2f3e4d5c6b7a",
        verdict: "useful",
        text: "good",
      },
      "POST",
      "/api/admin/agent-tasks/runs/r1/feedback",
      {
        feedbackId: "0b7e2b7a-1f7c-4a1e-9a6b-2f3e4d5c6b7a",
        verdict: "useful",
        text: "good",
      },
    );
  });
});

describe("web_background_agent_runs", () => {
  test("routes", async () => {
    await expectCall(
      "web_background_agent_runs",
      { action: "list", active: true },
      "GET",
      "/api/admin/background-agent/runs?active=true",
    );
    await expectCall(
      "web_background_agent_runs",
      { action: "create", prompt: "go", model: "m" },
      "POST",
      "/api/admin/background-agent/runs",
      { prompt: "go", model: "m", attachments: [] },
    );
    await expectCall(
      "web_background_agent_runs",
      { action: "get", runId: "r1" },
      "GET",
      "/api/admin/background-agent/runs/r1",
    );
    await expectCall(
      "web_background_agent_runs",
      { action: "delete", runId: "r1" },
      "DELETE",
      "/api/admin/background-agent/runs/r1",
    );
  });
});

describe("web_voice_notes", () => {
  test("routes", async () => {
    await expectCall(
      "web_voice_notes",
      { action: "list", q: "x", status: "failed", limit: 3 },
      "GET",
      "/api/admin/voice-notes?q=x&status=failed&limit=3",
    );
    await expectCall(
      "web_voice_notes",
      { action: "get", voiceNoteId: "n1" },
      "GET",
      "/api/admin/voice-notes/n1",
    );
    await expectCall(
      "web_voice_notes",
      { action: "update", voiceNoteId: "n1", title: "New" },
      "PATCH",
      "/api/admin/voice-notes/n1",
      { title: "New" },
    );
    await expectCall(
      "web_voice_notes",
      { action: "delete", voiceNoteId: "n1" },
      "DELETE",
      "/api/admin/voice-notes/n1",
    );
    await expectCall(
      "web_voice_notes",
      { action: "transcribe", voiceNoteId: "n1", force: true },
      "POST",
      "/api/admin/voice-notes/n1/transcribe",
      { force: true },
    );
    await expectCall(
      "web_voice_notes",
      { action: "generate_note", voiceNoteId: "n1", groupIds: ["g1"] },
      "POST",
      "/api/admin/voice-notes/n1/generate-note",
      { groupIds: ["g1"] },
    );
  });

  test("upload and transcribe_direct post multipart", async () => {
    await client.call("web_voice_notes", {
      action: "upload",
      filename: "a.webm",
      base64: tiny,
      contentType: "audio/webm",
      transcribe: true,
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/voice-notes");
    expect(last().body).toBe("[object FormData]");
    await client.call("web_voice_notes", {
      action: "transcribe_direct",
      filename: "a.webm",
      base64: tiny,
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/voice-notes/transcribe");
    expect(last().body).toBe("[object FormData]");
  });
});

describe("web_cv", () => {
  test("routes", async () => {
    await expectCall("web_cv", { action: "get" }, "GET", "/api/admin/cv");
    await expectCall(
      "web_cv",
      { action: "save", project: latexProject },
      "PUT",
      "/api/admin/cv",
      latexProject,
    );
    await expectCall(
      "web_cv",
      { action: "compile", project: latexProject },
      "POST",
      "/api/admin/cv/compile",
      latexProject,
    );
    await expectCall(
      "web_cv",
      { action: "publish" },
      "POST",
      "/api/admin/cv/publish",
    );
  });
});

describe("web_latex_projects", () => {
  test("routes", async () => {
    await expectCall(
      "web_latex_projects",
      { action: "list", includeArchived: true },
      "GET",
      "/api/admin/latex/projects?includeArchived=true",
    );
    await expectCall(
      "web_latex_projects",
      { action: "get", projectId: "l1" },
      "GET",
      "/api/admin/latex/projects/l1",
    );
    await expectCall(
      "web_latex_projects",
      { action: "create", name: "Thesis", project: latexProject },
      "POST",
      "/api/admin/latex/projects",
      { name: "Thesis", project: latexProject },
    );
    await expectCall(
      "web_latex_projects",
      { action: "update", projectId: "l1", baseRevision: 3, archived: true },
      "PATCH",
      "/api/admin/latex/projects/l1",
      { baseRevision: 3, archived: true },
    );
    await expectCall(
      "web_latex_projects",
      { action: "delete", projectId: "l1" },
      "DELETE",
      "/api/admin/latex/projects/l1",
    );
    await expectCall(
      "web_latex_projects",
      { action: "duplicate", projectId: "l1" },
      "POST",
      "/api/admin/latex/projects/l1/duplicate",
    );
    await expectCall(
      "web_latex_projects",
      {
        action: "compile",
        projectId: "l1",
        baseRevision: 3,
        project: latexProject,
      },
      "POST",
      "/api/admin/latex/projects/l1/compile",
      { baseRevision: 3, project: latexProject },
    );
    await expectCall(
      "web_latex_projects",
      { action: "data_points", projectId: "l1", query: "gpa trend" },
      "POST",
      "/api/admin/latex/projects/l1/data-points",
      { query: "gpa trend", limit: 8 },
    );
    await expectCall(
      "web_latex_projects",
      { action: "memory_context", projectId: "l1", query: "advisor" },
      "GET",
      "/api/admin/latex/memory-context?projectId=l1&query=advisor",
    );
    await expectCall(
      "web_latex_projects",
      {
        action: "template_overleaf",
        url: "https://www.overleaf.com/latex/templates/x",
      },
      "POST",
      "/api/admin/latex/templates/overleaf",
      { url: "https://www.overleaf.com/latex/templates/x" },
    );
  });

  test("template imports with an archive post multipart", async () => {
    await client.call("web_latex_projects", {
      action: "template_overleaf",
      url: "https://www.overleaf.com/latex/templates/x",
      filename: "x.zip",
      base64: tiny,
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/latex/templates/overleaf");
    expect(last().body).toBe("[object FormData]");
    await client.call("web_latex_projects", {
      action: "template_source",
      filename: "x.zip",
      base64: tiny,
    });
    expect(last().method).toBe("POST");
    expect(last().path).toBe("/api/admin/latex/templates/source");
    expect(last().body).toBe("[object FormData]");
  });
});

describe("web_latex_agent", () => {
  test("routes", async () => {
    await expectCall(
      "web_latex_agent",
      { action: "get", projectId: "l1" },
      "GET",
      "/api/admin/latex/projects/l1/agent",
    );
    const send = {
      baseRevision: 1,
      message: "tighten the abstract",
      model: "m",
      memoryMode: "enabled",
    };
    await expectCall(
      "web_latex_agent",
      { action: "send", projectId: "l1", ...send },
      "POST",
      "/api/admin/latex/projects/l1/agent",
      send,
    );
    const append = { ...send, response: "done" };
    await expectCall(
      "web_latex_agent",
      { action: "append", projectId: "l1", ...append },
      "PUT",
      "/api/admin/latex/projects/l1/agent",
      append,
    );
    await expectCall(
      "web_latex_agent",
      {
        action: "update_change",
        projectId: "l1",
        proposalId: "0b7e2b7a-1f7c-4a1e-9a6b-2f3e4d5c6b7a",
        status: "applied",
      },
      "PATCH",
      "/api/admin/latex/projects/l1/agent",
      { proposalId: "0b7e2b7a-1f7c-4a1e-9a6b-2f3e4d5c6b7a", status: "applied" },
    );
  });
});

describe("web_latex_history", () => {
  test("routes", async () => {
    await expectCall(
      "web_latex_history",
      { action: "list", projectId: "l1", snapshotId: "s1" },
      "GET",
      "/api/admin/latex/projects/l1/history?snapshotId=s1",
    );
    await expectCall(
      "web_latex_history",
      { action: "create", projectId: "l1", baseRevision: 4, snapshotId: "s1" },
      "POST",
      "/api/admin/latex/projects/l1/history",
      { baseRevision: 4, snapshotId: "s1" },
    );
  });
});

describe("web_latex_references", () => {
  test("routes", async () => {
    await expectCall(
      "web_latex_references",
      { action: "search", projectId: "l1", query: "attention is all you need" },
      "POST",
      "/api/admin/latex/projects/l1/references/search",
      { query: "attention is all you need", limit: 20 },
    );
    const before = calls.length;
    const accepted = await client.call("web_latex_references", {
      action: "accept",
      projectId: "l1",
      baseRevision: 1,
      bibliographyFile: "refs.bib",
    });
    expect(accepted.isError).toBe(true);
    expect(calls.length).toBe(before);
  });
});

describe("web_llm", () => {
  test("routes", async () => {
    await expectCall(
      "web_llm",
      {
        action: "models",
        creator: "anthropic",
        requiredCapability: ["tools", "vision"],
      },
      "GET",
      "/api/admin/llm/models?creator=anthropic&requiredCapability=tools&requiredCapability=vision",
    );
    await expectCall(
      "web_llm",
      {
        action: "usage",
        section: "recent",
        offset: 20,
        limit: 10,
        lastId: "x",
      },
      "GET",
      "/api/admin/llm/usage?section=recent&offset=20&limit=10&lastId=x",
    );
  });
});
