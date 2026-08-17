import { latexProjectSchema } from "@repo/schemas";
import {
  CvCompileBusyError,
  compileCvProject,
  getCvState,
  NoCvDraftError,
  publishCvDraft,
  saveCvProject,
} from "@/lib/cv-project";
import { LatexCompilationError } from "@/lib/latex-compiler";
import type { ToolDefinition } from "./types";

/**
 * The CV is a LaTeX project that compiles to the PDF denizlg24.com serves.
 *
 * Two stages, deliberately: compile_cv produces a draft and changes nothing
 * public, publish_cv promotes that draft and revalidates the homepage. A model
 * should compile, read the log, and only publish once the result is right.
 */

const COMPILE_LOG_TAIL = 4_000;

export const cvTools: ToolDefinition[] = [
  {
    schema: {
      name: "get_cv",
      description:
        "The published CV, any compiled-but-unpublished draft, and the LaTeX project source behind them.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: false,
    category: "cv",
    execute: async () => getCvState(),
  },
  {
    schema: {
      name: "save_cv_project",
      description:
        "Save the LaTeX project source without compiling. Use compile_cv when a PDF is wanted; this only stores the edit.",
      input_schema: {
        type: "object",
        properties: {
          project: {
            type: "object",
            description:
              "Full LaTeX project: { files: [{ path, content, ... }], entryPath }. Replaces the stored source entirely, so read it with get_cv first and send the whole project back.",
          },
        },
        required: ["project"],
      },
    },
    isWrite: true,
    category: "cv",
    execute: async (input) => {
      const parsed = latexProjectSchema.safeParse(input.project);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid LaTeX project",
        );
      }
      return saveCvProject(parsed.data);
    },
  },
  {
    schema: {
      name: "compile_cv",
      description:
        "Compile the LaTeX project into a draft PDF. Saves the source, then builds it. Nothing public changes — the homepage still serves the previously published CV until publish_cv runs. A LaTeX error comes back as a log to fix, not a failure.",
      input_schema: {
        type: "object",
        properties: {
          project: {
            type: "object",
            description:
              "Full LaTeX project to compile. Omit to recompile the stored source unchanged.",
          },
        },
      },
    },
    isWrite: true,
    category: "cv",
    execute: async (input) => {
      let project = input.project;
      if (project === undefined) {
        const state = await getCvState();
        if (!state.project) {
          throw new Error("No stored CV project to compile");
        }
        project = state.project;
      }
      const parsed = latexProjectSchema.safeParse(project);
      if (!parsed.success) {
        throw new Error(
          parsed.error.issues[0]?.message ?? "Invalid LaTeX project",
        );
      }

      try {
        const result = await compileCvProject(parsed.data);
        return {
          ...result,
          // The source is echoed back by compileCvProject; the caller already
          // has it and a full LaTeX project is large.
          project: undefined,
          log: result.log?.slice(-COMPILE_LOG_TAIL),
        };
      } catch (error) {
        if (error instanceof CvCompileBusyError) {
          throw new Error(error.message);
        }
        if (error instanceof LatexCompilationError) {
          // Returned rather than thrown: the log is the useful result, and the
          // fix is an edit to the source, not a retry.
          return {
            compiled: false,
            error: error.message,
            log: error.log?.slice(-COMPILE_LOG_TAIL),
          };
        }
        throw error;
      }
    },
  },
  {
    schema: {
      name: "publish_cv",
      description:
        "Promote the compiled draft to the published CV and revalidate the homepage. This changes what visitors to denizlg24.com download, so only call it once the draft has been checked.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: true,
    category: "cv",
    execute: async () => {
      try {
        const result = await publishCvDraft();
        return { ...result, project: undefined };
      } catch (error) {
        if (error instanceof NoCvDraftError) {
          throw new Error(
            "No compiled draft to publish — run compile_cv first",
          );
        }
        throw error;
      }
    },
  },
];
