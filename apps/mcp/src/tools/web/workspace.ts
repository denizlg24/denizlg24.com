import type { McpServer } from "@modelcontextprotocol/server";
import {
  ENTITY_KINDS,
  entityKindSchema,
  entityRefSchema,
  pageMetaPatchSchema,
  RECORD_REFS_MAX,
  templateFromBlocksSchema,
  templateInsertSchema,
  templateInstantiateSchema,
  VIEW_FILTER_OPS_BY_TYPE,
  VIEW_SOURCES,
  viewConfigSchema,
  WORKSPACE_OPS_MAX,
  workspaceMarkdownPutSchema,
  workspaceOpSchema,
  workspacePageCreateSchema,
  workspacePageIdSchema,
  workspacePageMoveSchema,
  workspaceRevertSchema,
} from "@repo/schemas";
import { z } from "zod";
import {
  type Api,
  action,
  defineActions,
  isRecord,
  mapResult,
  ok,
} from "../define";

const id = workspacePageIdSchema;
const blockId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,64}$/)
  .describe("Block id");
/** Rows an agent reads per call; the app pages views by its own limit. */
const VIEW_ROWS_MAX = 50;
const PAGES = "/api/admin/workspace/pages";
const TEMPLATES = "/api/admin/workspace/templates";
const template = (templateId: string, suffix: string) =>
  `${TEMPLATES}/${encodeURIComponent(templateId)}${suffix}`;
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
          "Every live and trashed page as a summary (fields, rev, blockCount; no blocks). Templates are left out unless templates is true; web_workspace_templates lists them with their inputs",
        input: z.object({
          templates: z.boolean().optional().describe("Include template pages"),
        }),
        readOnly: true,
        run: async ({ templates }) =>
          mapResult(await api.web.get(PAGES), (value) => {
            if (templates || !isRecord(value) || !Array.isArray(value.pages)) {
              return value;
            }
            return {
              ...value,
              pages: value.pages.filter(
                (summary) => !(isRecord(summary) && summary.template === true),
              ),
            };
          }),
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
        description:
          "Title, icon, full width, locked, or template (true lists it under Templates instead of the page tree)",
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
        description: `The page as markdown with its rev: text blocks are plain markdown ending in a <!-- id=… --> marker, list children are indented, toggles are <details>, callouts and columns are :::callout / :::columns / :::column directives, other blocks are :::block{type id} directives with JSON bodies, mentions are [@Name](person:id) / [@](page:id) / [@2026-10-29](date:2026-10-29) / [@Title](note:id) (any record kind), record embeds and module views are :::block{type="record"} / :::block{type="view"} directives carrying their ref or query, never rows. Keep markers and directives intact when sending it back`,
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
          "insert {block, parentId?, after?} (parentId: a toggle, list item, callout, quote or column, absent for the page; after: a sibling id, null first, absent last; the block may carry its own children), update {id, set, type?} (merges fields; replace: true swaps them all; type turns the block into another, keeping its id and children; children never go in set), move {id, parentId?, after?}, delete {id} (takes its children), page {set: title/icon/fullWidth/locked}. Text is rich-text runs: {type:'text', text, bold?, italic?, strike?, code?, link?} or {type:'mention', kind: page|person|date or any record kind (note, kanban-card, …), id, label?}. A columns block holds only column blocks {width, children}. A record embed is {type:'record', ref:'entity:<kind>:<id>', mode:'card'|'full'} (find refs with web_workspace_records search); a module view is {type:'view', source, layout, filters, sort, group?, limit, fields?, dateField?, title?} (fields and operators per source from web_workspace_views sources). A button is {type:'button', label, mode:'actions'|'agent', actions, agentPrompt}: actions are {kind:'create-page'|'append-blocks'|'insert-template'|'create-card'|'create-event'|'set-todo'|'open', …} run in order when pressed, pageId '$this' meaning the button's page; agentPrompt starts a background run with the page as context",
        input: z.object({
          id,
          baseRev: z.number().int().min(0),
          ops: z.array(workspaceOpSchema).min(1).max(WORKSPACE_OPS_MAX),
        }),
        run: ({ id, ...body }) => api.web.post(page(id, "/ops"), body),
      }),
    },
  });

  defineActions(server, {
    name: "web_workspace_templates",
    title: "Web: workspace templates",
    description:
      "Template pages: copied with fresh block ids into a new page or into an existing one. Text may hold {{date}}, {{time}}, {{week}}, {{weekday}} (the owner's time zone, when used), {{page.title}} (the page the blocks land in) and {{input:Name}} prompts, filled from inputs (a missing input is empty). Button actions and agent prompts are copied verbatim. Mark a page a template with web_workspace_pages update template: true",
    actions: {
      list: action({
        description: "Every template: id, title, icon, its input names",
        readOnly: true,
        run: () => api.web.get(TEMPLATES),
      }),
      instantiate: action({
        description:
          "A new page from template id under parentId (null for the top level); title overrides the template's own",
        input: z.object({ id, ...templateInstantiateSchema.shape }),
        run: ({ id, ...body }) =>
          api.web.post(template(id, "/instantiate"), body),
      }),
      insert: action({
        description:
          "Template id's blocks inserted into page pageId, after block after (null first, absent last), under parentId when given",
        input: z.object({ id, ...templateInsertSchema.shape }),
        run: ({ id, ...body }) => api.web.post(template(id, "/insert"), body),
      }),
      save_blocks: action({
        description:
          "Copies blocks of page pageId (document order, with their children) into a new template titled title",
        input: z.object(templateFromBlocksSchema.shape),
        run: (body) => api.web.post(TEMPLATES, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_workspace_records",
    title: "Web: workspace records",
    description: `Records a page can embed or mention, addressed as entity:<kind>:<id> (kinds: ${ENTITY_KINDS.join(", ")}): a title, a subtitle and a few key fields each.`,
    actions: {
      resolve: action({
        description:
          "Summaries for refs; refs that point at nothing (deleted, trashed) come back in missing",
        input: z.object({
          refs: z.array(entityRefSchema).min(1).max(RECORD_REFS_MAX),
        }),
        readOnly: true,
        run: ({ refs }) =>
          api.web.get("/api/admin/workspace/records", { refs: refs.join(",") }),
      }),
      search: action({
        description:
          "Records whose title contains q, a few per kind; the most recently changed when q is empty",
        input: z.object({
          q: z.string().max(100),
          kind: z.array(entityKindSchema).optional(),
        }),
        readOnly: true,
        run: ({ q, kind }) =>
          api.web.get("/api/admin/workspace/records/search", {
            q,
            ...(kind ? { kind } : {}),
          }),
      }),
    },
  });

  defineActions(server, {
    name: "web_workspace_views",
    title: "Web: workspace views",
    description:
      "Module views: live queries over one module (kanban cards, calendar events, notes, finance entries, course assignments, people, triage, agent tasks, papers, voice notes) that pages hold as view blocks. Read what a view shows; edit its query through web_workspace_blocks.",
    actions: {
      sources: action({
        description:
          "Every source's fields (text, number, date, select, boolean, person, money), the operators each field type filters with, the row's entity kind, and which fields the database filters natively",
        readOnly: true,
        run: async () =>
          ok({ sources: VIEW_SOURCES, operators: VIEW_FILTER_OPS_BY_TYPE }),
      }),
      query: action({
        description: `Runs a view: either an inline view, or the view block blockId on page pageId. Answers one page of rows (at most ${VIEW_ROWS_MAX}; pass nextCursor back as cursor), the matching total, groups with counts, and money totals per field and currency — never summed across currencies. truncated means the source had more rows than one query reads`,
        input: z.object({
          view: viewConfigSchema.optional(),
          pageId: id.optional(),
          blockId: blockId.optional(),
          limit: z.number().int().min(1).max(VIEW_ROWS_MAX).optional(),
          cursor: z
            .string()
            .regex(/^\d{1,6}$/)
            .optional(),
          today: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe(
              "Local date relative date filters count from; UTC today when absent",
            ),
        }),
        readOnly: true,
        run: async ({ limit, ...body }) =>
          mapResult(
            await api.web.post("/api/admin/workspace/views/query", {
              ...body,
              limit: Math.min(limit ?? body.view?.limit ?? 25, VIEW_ROWS_MAX),
            }),
            // Select options are for the app's filter pickers, not for reading.
            (value) => {
              if (!isRecord(value)) return value;
              const { options: _options, ...rest } = value;
              return rest;
            },
          ),
      }),
    },
  });
}
