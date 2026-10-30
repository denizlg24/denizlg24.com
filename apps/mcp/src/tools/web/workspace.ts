import type { McpServer } from "@modelcontextprotocol/server";
import {
  pageMetaPatchSchema,
  WORKSPACE_OPS_MAX,
  workspaceMarkdownPutSchema,
  workspaceOpSchema,
  workspacePageCreateSchema,
  workspacePageIdSchema,
  workspacePageMoveSchema,
  workspaceRevertSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions } from "../define";

const id = workspacePageIdSchema;
const PAGES = "/api/admin/workspace/pages";
const page = (pageId: string, suffix = "") =>
  `${PAGES}/${encodeURIComponent(pageId)}${suffix}`;

export function registerWebWorkspace(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_workspace_pages",
    title: "Web: workspace pages",
    description:
      "The workspace desktop and web share: a tree of pages, each a document of nested blocks (text, lists, toggles, callouts, columns, embeds, live widgets). Every change bumps a page's rev and is logged with who made it. Locked pages refuse every change but the owner's.",
    actions: {
      list: action({
        description:
          "Every live and trashed page as a summary (fields, rev, blockCount; no blocks)",
        readOnly: true,
        run: () => api.web.get(PAGES),
      }),
      get: action({
        description: "One page with its blocks and rev",
        input: z.object({ id }),
        readOnly: true,
        run: ({ id }) => api.web.get(page(id)),
      }),
      create: action({
        description:
          "A new page under parentId (null for the top level); blocks from `blocks` or from `markdown`",
        input: z.object({
          ...workspacePageCreateSchema.shape,
          markdown: z
            .string()
            .optional()
            .describe("Builds the blocks instead of `blocks`"),
        }),
        run: (body) => api.web.post(PAGES, body),
      }),
      update: action({
        description: "Title, icon, full width or locked",
        input: z.object({ id, ...pageMetaPatchSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) => api.web.patch(page(id), body),
      }),
      move: action({
        description: "Re-parents the page at index among its new siblings",
        input: z.object({ id, ...workspacePageMoveSchema.shape }),
        run: ({ id, ...body }) => api.web.post(page(id, "/move"), body),
      }),
      archive: action({
        description: "Moves the page and its subtree to the trash",
        input: z.object({ id }),
        destructive: true,
        run: ({ id }) => api.web.post(page(id, "/archive")),
      }),
      restore: action({
        description: "Brings a trashed page and its subtree back",
        input: z.object({ id }),
        run: ({ id }) => api.web.post(page(id, "/restore")),
      }),
      to_markdown: action({
        description:
          "The page as markdown with its rev: text blocks are plain markdown ending in a <!-- id=… --> marker, list children are indented, toggles are <details>, callouts and columns are :::callout / :::columns / :::column directives, other blocks are :::block{type id} directives with JSON bodies, mentions are [@Name](person:id) / [@](page:id) / [@2026-10-29](date:2026-10-29). Keep markers and directives intact when sending it back",
        input: z.object({ id }),
        readOnly: true,
        run: ({ id }) => api.web.get(page(id, "/markdown")),
      }),
      from_markdown: action({
        description:
          "Replaces every block with what the markdown describes; baseRev must be the current rev. Prefer web_workspace_blocks apply for anything smaller than a rewrite",
        input: z.object({ id, ...workspaceMarkdownPutSchema.shape }),
        destructive: true,
        run: ({ id, ...body }) => api.web.put(page(id, "/markdown"), body),
      }),
      history: action({
        description:
          "Revisions, newest first: rev, actor, kind, touched block ids",
        input: z.object({
          id,
          limit: z.number().int().min(1).max(200).optional(),
          before: z
            .number()
            .int()
            .min(1)
            .optional()
            .describe("Older than this rev"),
        }),
        readOnly: true,
        run: ({ id, ...query }) => api.web.get(page(id, "/history"), query),
      }),
      revert: action({
        description:
          "rev restores the page's blocks and fields as they stood then; actor (with optional sinceRev) undoes that actor's changes, skipping blocks someone else touched later",
        input: z.object({ id, ...workspaceRevertSchema.shape }),
        destructive: true,
        run: ({ id, ...body }) => api.web.post(page(id, "/revert"), body),
      }),
      changes: action({
        description:
          "Pages changed since a cursor (ISO time; the previous answer's cursor), plus pages deleted for good",
        input: z.object({ since: z.string().optional() }),
        readOnly: true,
        run: (query) => api.web.get("/api/admin/workspace/changes", query),
      }),
    },
  });

  defineActions(server, {
    name: "web_workspace_blocks",
    title: "Web: workspace blocks",
    description: `Edits one page's blocks by id, at any depth. A batch (up to ${WORKSPACE_OPS_MAX} ops) applies in order against baseRev, the rev you read: if a block it targets changed since, or one of its ancestors moved or was deleted, the answer is a 409 carrying the current page — re-read and redo the batch on it.`,
    actions: {
      get: action({
        description: "The page's blocks and rev, to address ops at",
        input: z.object({ id }),
        readOnly: true,
        run: ({ id }) => api.web.get(page(id)),
      }),
      apply: action({
        description:
          "insert {block, parentId?, after?} (parentId: a toggle, list item, callout, quote or column, absent for the page; after: a sibling id, null first, absent last; the block may carry its own children), update {id, set, type?} (merges fields; replace: true swaps them all; type turns the block into another, keeping its id and children; children never go in set), move {id, parentId?, after?}, delete {id} (takes its children), page {set: title/icon/fullWidth/locked}. Text is rich-text runs: {type:'text', text, bold?, italic?, strike?, code?, link?} or {type:'mention', kind: page|person|date, id, label?}. A columns block holds only column blocks {width, children}",
        input: z.object({
          id,
          baseRev: z.number().int().min(0),
          ops: z.array(workspaceOpSchema).min(1).max(WORKSPACE_OPS_MAX),
        }),
        run: ({ id, ...body }) => api.web.post(page(id, "/ops"), body),
      }),
    },
  });
}
