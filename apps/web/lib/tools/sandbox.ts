import {
  listSandboxFiles,
  readSandboxFile,
  runSandboxCommand,
  SANDBOX_RUNTIME,
  sandboxPortUrl,
  stopSandbox,
  writeSandboxFiles,
} from "@/lib/sandbox";
import type { ToolDefinition, ToolExecutionContext } from "./types";

// The sandbox is scoped to the conversation, so every tool needs one. Chats
// that were never persisted have no id and therefore no sandbox.
function requireConversation(context?: ToolExecutionContext): string {
  if (!context?.conversationId) {
    throw new Error(
      "The sandbox needs a saved conversation. Send a message first so the conversation is created.",
    );
  }
  return context.conversationId;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

export const sandboxTools: ToolDefinition[] = [
  {
    schema: {
      name: "sandbox_write_files",
      description: `Write UTF-8 files into the conversation's ${SANDBOX_RUNTIME} sandbox, creating parent directories as needed. Existing files are replaced. Use this to author scripts before running them; the sandbox persists for the conversation, so earlier files are still there.`,
      input_schema: {
        type: "object",
        properties: {
          files: {
            type: "array",
            description: "Files to write.",
            items: {
              type: "object",
              properties: {
                path: {
                  type: "string",
                  description:
                    "Absolute path or path relative to the sandbox working directory.",
                },
                content: {
                  type: "string",
                  description: "Full file contents.",
                },
              },
              required: ["path", "content"],
            },
          },
        },
        required: ["files"],
      },
    },
    isWrite: false,
    category: "sandbox",
    execute: async (input, context) => {
      const raw = Array.isArray(input.files) ? input.files : [];
      const files = raw.flatMap((entry) => {
        if (!entry || typeof entry !== "object") return [];
        const value = entry as { path?: unknown; content?: unknown };
        if (typeof value.path !== "string" || typeof value.content !== "string")
          return [];
        return [{ path: value.path, content: value.content }];
      });
      if (files.length === 0) throw new Error("No valid files were provided");
      return writeSandboxFiles({
        conversationId: requireConversation(context),
        files,
      });
    },
  },
  {
    schema: {
      name: "sandbox_run_command",
      description: `Run a command in the conversation's ${SANDBOX_RUNTIME} sandbox and return exitCode, stdout, and stderr. The sandbox has network access and is provisioned with the system's database, Redis, and S3 credentials as environment variables, so scripts can query real data. Node and npm are available; install packages with npm before importing them. Commands are killed after five minutes.`,
      input_schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Executable to run, for example 'node' or 'npm'.",
          },
          args: {
            type: "array",
            description: "Arguments passed to the command.",
            items: { type: "string" },
          },
          cwd: {
            type: "string",
            description: "Working directory for this command.",
          },
          timeoutMs: {
            type: "number",
            description:
              "Kill the command after this many milliseconds. Capped at 300000.",
          },
        },
        required: ["command"],
      },
    },
    // Arbitrary code with the forwarded production credentials — this belongs
    // behind the approval gate even though it writes nothing itself.
    isWrite: true,
    category: "sandbox",
    execute: async (input, context) => {
      const command = typeof input.command === "string" ? input.command : "";
      if (!command) throw new Error("command is required");
      return runSandboxCommand({
        conversationId: requireConversation(context),
        command,
        args: stringArray(input.args),
        cwd: typeof input.cwd === "string" ? input.cwd : undefined,
        timeoutMs:
          typeof input.timeoutMs === "number" ? input.timeoutMs : undefined,
      });
    },
  },
  {
    schema: {
      name: "sandbox_read_file",
      description:
        "Read a UTF-8 file from the sandbox. Use it to inspect generated output, logs, or files a command produced.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to the file." },
        },
        required: ["path"],
      },
    },
    isWrite: false,
    category: "sandbox",
    execute: async (input, context) => {
      const path = typeof input.path === "string" ? input.path : "";
      if (!path) throw new Error("path is required");
      return {
        path,
        content: await readSandboxFile({
          conversationId: requireConversation(context),
          path,
        }),
      };
    },
  },
  {
    schema: {
      name: "sandbox_list_files",
      description:
        "List a directory in the sandbox. Directory names end with a slash.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory to list. Defaults to the working directory.",
          },
        },
      },
    },
    isWrite: false,
    category: "sandbox",
    execute: async (input, context) => {
      const path =
        typeof input.path === "string" && input.path ? input.path : ".";
      return {
        path,
        entries: await listSandboxFiles({
          conversationId: requireConversation(context),
          path,
        }),
      };
    },
  },
  {
    schema: {
      name: "sandbox_port_url",
      description:
        "Get the public URL for a port exposed by the sandbox, after starting a server on it. Only port 3000 is exposed.",
      input_schema: {
        type: "object",
        properties: {
          port: {
            type: "number",
            description: "Port number the server is listening on.",
          },
        },
        required: ["port"],
      },
    },
    isWrite: false,
    category: "sandbox",
    execute: async (input, context) => {
      const port = typeof input.port === "number" ? input.port : 3000;
      return {
        port,
        url: await sandboxPortUrl({
          conversationId: requireConversation(context),
          port,
        }),
      };
    },
  },
  {
    schema: {
      name: "sandbox_stop",
      description:
        "Stop the conversation's sandbox and discard its filesystem. A later sandbox tool call starts a fresh one.",
      input_schema: { type: "object", properties: {} },
    },
    isWrite: true,
    category: "sandbox",
    execute: async (_input, context) => {
      return {
        stopped: await stopSandbox(requireConversation(context)),
      };
    },
  },
];
