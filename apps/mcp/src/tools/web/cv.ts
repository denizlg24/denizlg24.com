import type { McpServer } from "@modelcontextprotocol/server";
import { latexProjectSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, isRecord } from "../define";
import { COMPILE_DEADLINE_MS, compileThroughStream } from "./compile-stream";

const project = z.object({ project: latexProjectSchema });

export function registerWebCv(
  server: McpServer,
  api: Api,
  { compileDeadlineMs = COMPILE_DEADLINE_MS } = {},
) {
  defineActions(server, {
    name: "web_cv",
    title: "Web: CV",
    description: "The LaTeX CV published on the public site.",
    actions: {
      get: action({
        description: "Stored PDF metadata and LaTeX project",
        readOnly: true,
        run: () => api.web.get("/api/admin/cv"),
      }),
      save: action({
        description: "Saves the LaTeX project draft without compiling",
        input: project,
        idempotent: true,
        run: ({ project }) => api.web.put("/api/admin/cv", project),
      }),
      compile: action({
        description:
          "Saves the source, compiles it and uploads the draft PDF; waits for the outcome",
        input: project,
        run: ({ project }) =>
          compileThroughStream(api, {
            path: "/api/admin/cv/compile",
            body: project,
            deadlineMs: compileDeadlineMs,
            summarize: (payload) =>
              isRecord(payload)
                ? { cv: payload.cv ?? null, draft: payload.draft ?? null }
                : {},
            afterDeadline:
              "Call get and compare draft.updatedAt before compiling again.",
          }),
      }),
      publish: action({
        description: "Revalidates the public page",
        idempotent: true,
        run: () => api.web.post("/api/admin/cv/publish"),
      }),
    },
  });
}
