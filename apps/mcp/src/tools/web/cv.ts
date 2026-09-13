import type { McpServer } from "@modelcontextprotocol/server";
import { latexProjectSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions } from "../define";

const project = z.object({ project: latexProjectSchema });

export function registerWebCv(server: McpServer, api: Api) {
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
        description: "Compiles the project, uploads the PDF and revalidates /",
        input: project,
        run: ({ project }) => api.web.post("/api/admin/cv/compile", project),
      }),
      publish: action({
        description: "Revalidates the public page",
        idempotent: true,
        run: () => api.web.post("/api/admin/cv/publish"),
      }),
    },
  });
}
