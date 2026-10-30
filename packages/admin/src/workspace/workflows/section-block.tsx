"use client";

import {
  type BlockOf,
  SECTION_SOURCES_MAX,
  type SectionState,
  sectionSourceSchema,
  sectionStateSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { StatusDot } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { blocksToMarkdown } from "@repo/utils/workspace-markdown";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Check, Pin, Play, Settings2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAdmin } from "../../provider";
import { flushWorkspace, useWorkspaceStore } from "../store";

export type SectionConfig = Omit<
  BlockOf<"section">,
  "id" | "type" | "children"
>;

const stateResponseSchema = z.object({ state: sectionStateSchema });
const POLL_MS = 4_000;
const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

function live(state: SectionState | null): boolean {
  return (
    state?.lastRun?.status === "queued" || state?.lastRun?.status === "running"
  );
}

function ago(iso: string): string {
  return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
}

function SectionDialog({
  open,
  onOpenChange,
  config,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: SectionConfig;
  onSave: (config: SectionConfig) => void;
}) {
  const [title, setTitle] = useState(config.title);
  const [prompt, setPrompt] = useState(config.prompt);
  const [cron, setCron] = useState(config.schedule?.cron ?? "");
  const [timeZone, setTimeZone] = useState(
    config.schedule?.timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [sources, setSources] = useState(config.sources.join("\n"));
  const [pinned, setPinned] = useState(config.pinned);
  useEffect(() => {
    if (!open) return;
    setTitle(config.title);
    setPrompt(config.prompt);
    setCron(config.schedule?.cron ?? "");
    setTimeZone(
      config.schedule?.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    setSources(config.sources.join("\n"));
    setPinned(config.pinned);
  }, [open, config]);

  const parsedSources = sources
    .split(/\s+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const invalid = parsedSources.filter(
    (source) => !sectionSourceSchema.safeParse(source).success,
  );
  const cronOk = !cron.trim() || cron.trim().split(/\s+/).length === 5;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Agent section"
      size="lg"
      submitDisabled={
        invalid.length > 0 ||
        !cronOk ||
        parsedSources.length > SECTION_SOURCES_MAX
      }
      onSubmit={() => {
        onSave({
          title,
          prompt,
          schedule: cron.trim() ? { cron: cron.trim(), timeZone } : null,
          sources: parsedSources.filter(
            (source) => sectionSourceSchema.safeParse(source).success,
          ),
          pinned,
        });
        onOpenChange(false);
      }}
    >
      <FormGrid>
        <FormField label="Title" htmlFor="section-title">
          <Input
            id="section-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField label="Pinned" htmlFor="section-pinned">
          <Switch
            id="section-pinned"
            checked={pinned}
            onCheckedChange={setPinned}
          />
        </FormField>
      </FormGrid>
      <FormField label="Prompt" htmlFor="section-prompt">
        <Textarea
          id="section-prompt"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          className="min-h-32"
        />
      </FormField>
      <FormGrid>
        <FormField
          label="Schedule"
          htmlFor="section-cron"
          error={cronOk ? undefined : "Five cron fields"}
        >
          <Input
            id="section-cron"
            value={cron}
            placeholder="0 7 * * *"
            onChange={(event) => setCron(event.target.value)}
            className="font-mono"
          />
        </FormField>
        <FormField label="Time zone" htmlFor="section-zone">
          <Input
            id="section-zone"
            value={timeZone}
            onChange={(event) => setTimeZone(event.target.value)}
          />
        </FormField>
      </FormGrid>
      <FormField
        label="Sources"
        htmlFor="section-sources"
        error={invalid.length > 0 ? invalid.join(", ") : undefined}
      >
        <Textarea
          id="section-sources"
          value={sources}
          placeholder="entity:note:… / view:<pageId>:<blockId>"
          onChange={(event) => setSources(event.target.value)}
          className="font-mono text-xs"
        />
      </FormField>
    </FormDialog>
  );
}

/**
 * The strip above an agent section's children: its title, the last run and
 * what it did, Run now, and a pending proposal to accept or reject.
 */
export function SectionHeader({
  pageId,
  blockId,
  config,
  editable,
  onChange,
}: {
  pageId: string;
  blockId: string;
  config: SectionConfig;
  editable: boolean;
  onChange: (config: SectionConfig) => void;
}) {
  const { client } = useAdmin();
  const refresh = useWorkspaceStore((s) => s.refresh);
  const [state, setState] = useState<SectionState | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showProposal, setShowProposal] = useState(false);
  const query = `pageId=${encodeURIComponent(pageId)}&blockId=${encodeURIComponent(blockId)}`;

  const load = useCallback(async () => {
    try {
      setState(
        stateResponseSchema.parse(
          await client.get(`workspace/sections?${query}`),
        ).state,
      );
    } catch {
      // The strip keeps what it showed.
    }
  }, [client, query]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!live(state)) return;
    const timer = setInterval(() => {
      void load().then(() => refresh());
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [state, load, refresh]);

  const call = async (path: string, body: object) => {
    setBusy(true);
    try {
      await flushWorkspace();
      setState(
        stateResponseSchema.parse(
          await client.post(path, { pageId, blockId, ...body }),
        ).state,
      );
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Section failed");
    } finally {
      setBusy(false);
    }
  };

  const run = state?.lastRun ?? null;
  return (
    <div contentEditable={false} className="flex flex-col gap-1.5 select-none">
      <div className="flex min-h-7 items-center gap-2">
        <span className={LABEL}>{config.title || "Agent section"}</span>
        {config.pinned ? (
          <Pin className="size-3 text-muted-foreground" aria-label="Pinned" />
        ) : null}
        <div className="h-px flex-1 bg-border" />
        {run ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot
              tone={
                run.status === "failed"
                  ? "critical"
                  : live(state)
                    ? "warning"
                    : run.outcome === "proposed"
                      ? "serious"
                      : "good"
              }
              className={live(state) ? "animate-pulse" : undefined}
            />
            <span>{run.outcome ?? run.status}</span>
            <span className="tabular-nums">{ago(run.at)}</span>
          </span>
        ) : null}
        {state?.nextRunAt ? (
          <span className="text-xs tabular-nums text-muted-foreground">
            next {ago(state.nextRunAt)}
          </span>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Run now"
          disabled={busy || live(state) || !config.prompt.trim()}
          onClick={() => void call("workspace/sections/run", {})}
        >
          <Play />
        </Button>
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Edit section"
            onClick={() => setEditing(true)}
          >
            <Settings2 />
          </Button>
        ) : null}
      </div>
      {state?.proposal ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              Proposed {ago(state.proposal.at)} · {state.proposal.blocks.length}{" "}
              blocks
            </span>
            <button
              type="button"
              className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-accent-strong"
              onClick={() => setShowProposal((open) => !open)}
            >
              {showProposal ? "Hide" : "Show"}
            </button>
            <div className="flex-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void call("workspace/sections/decision", {
                  decision: "accept",
                })
              }
            >
              <Check />
              Accept
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() =>
                void call("workspace/sections/decision", {
                  decision: "reject",
                })
              }
            >
              <X />
              Reject
            </Button>
          </div>
          {showProposal ? (
            <pre className="max-h-64 overflow-auto rounded-sm bg-surface px-3 py-2 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {blocksToMarkdown(state.proposal.blocks)}
            </pre>
          ) : null}
        </div>
      ) : null}
      {editable ? (
        <SectionDialog
          open={editing}
          onOpenChange={setEditing}
          config={config}
          onSave={onChange}
        />
      ) : null}
    </div>
  );
}
