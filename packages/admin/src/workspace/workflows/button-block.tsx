"use client";

import {
  type BlockOf,
  type ButtonAgentRun,
  type ButtonMode,
  buttonAgentRunSchema,
  buttonRunResponseSchema,
  type WorkflowAction,
  type WorkflowActionResult,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { StatusDot } from "@repo/ui/status-dot";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Bot, Settings2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useOptionalAgentSession } from "../../agent/agent-session";
import { useAdmin } from "../../provider";
import { flushWorkspace, useWorkspaceStore } from "../store";
import { useWorkspaceNav } from "../use-workspace-nav";
import { ActionListEditor } from "./action-editor";

const lastRunSchema = z.object({ run: buttonAgentRunSchema.nullable() });
const POLL_MS = 3_000;

function isLive(run: ButtonAgentRun | null): boolean {
  return run?.status === "queued" || run?.status === "running";
}

/** The agent run line under an agent button: status, age, and the way into it. */
export function RunStatus({
  run,
  className,
}: {
  run: ButtonAgentRun;
  className?: string;
}) {
  const session = useOptionalAgentSession();
  const at = run.completedAt ?? run.startedAt;
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <StatusDot
        tone={
          run.status === "failed"
            ? "critical"
            : isLive(run)
              ? "warning"
              : run.status === "cancelled"
                ? "muted"
                : "good"
        }
        className={isLive(run) ? "animate-pulse" : undefined}
      />
      <span>{run.status}</span>
      <span className="tabular-nums">
        {formatDistanceToNowStrict(parseISO(at), { addSuffix: true })}
      </span>
      {session ? (
        <button
          type="button"
          className="underline decoration-muted-foreground/50 underline-offset-2 hover:text-accent-strong"
          onClick={() => {
            void session.openConversation(run.conversationId);
            window.dispatchEvent(new Event("agent:open"));
          }}
        >
          Open
        </button>
      ) : null}
    </span>
  );
}

function ButtonDialog({
  open,
  onOpenChange,
  block,
  pageId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  block: BlockOf<"button">;
  pageId: string;
  onSave: (block: BlockOf<"button">) => void;
}) {
  const [label, setLabel] = useState(block.label);
  const [mode, setMode] = useState<ButtonMode>(block.mode);
  const [actions, setActions] = useState<WorkflowAction[]>(block.actions);
  const [prompt, setPrompt] = useState(block.agentPrompt);
  useEffect(() => {
    if (!open) return;
    setLabel(block.label);
    setMode(block.mode);
    setActions(block.actions);
    setPrompt(block.agentPrompt);
  }, [open, block]);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Button"
      size="lg"
      onSubmit={() => {
        onSave({ ...block, label, mode, actions, agentPrompt: prompt });
        onOpenChange(false);
      }}
    >
      <FormGrid>
        <FormField label="Label" htmlFor="button-label">
          <Input
            id="button-label"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </FormField>
        <FormField label="Runs">
          <SegmentedControl
            ariaLabel="Runs"
            value={mode}
            options={[
              { value: "actions", label: "Actions" },
              { value: "agent", label: "Agent" },
            ]}
            onValueChange={setMode}
          />
        </FormField>
      </FormGrid>
      {mode === "agent" ? (
        <FormField label="Prompt" htmlFor="button-prompt">
          <Textarea
            id="button-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="min-h-32"
          />
        </FormField>
      ) : (
        <ActionListEditor
          actions={actions}
          onChange={setActions}
          hostPageId={pageId}
        />
      )}
    </FormDialog>
  );
}

function summarise(
  results: WorkflowActionResult[],
  openUrl: (url: string) => void,
  openPage: (pageId: string) => void,
) {
  for (const result of results) {
    if (result.ok && result.url) openUrl(result.url);
  }
  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    toast.error(
      failed.map((r) => `${r.index + 1}. ${r.error ?? "Failed"}`).join("\n"),
    );
    return;
  }
  const created = results.find(
    (result) => result.kind === "create-page" && result.pageId,
  );
  const done = results.filter((r) => !r.skipped && !r.url).length;
  if (done === 0) return;
  toast.success(
    `${done} done`,
    created?.pageId
      ? {
          action: {
            label: "Open",
            onClick: () => created.pageId && openPage(created.pageId),
          },
        }
      : undefined,
  );
}

export function ButtonBlock({
  block,
  pageId,
  editable,
  selected,
  onChange,
}: {
  block: BlockOf<"button">;
  /** The page the button sits on; its actions' "this page". */
  pageId: string;
  editable: boolean;
  selected: boolean;
  onChange: (block: BlockOf<"button">) => void;
}) {
  const { client, platform } = useAdmin();
  const { pageHref } = useWorkspaceNav();
  const refresh = useWorkspaceStore((s) => s.refresh);
  const [pending, setPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [run, setRun] = useState<ButtonAgentRun | null>(null);

  const loadRun = useCallback(async () => {
    try {
      const body = lastRunSchema.parse(
        await client.get(
          `workspace/buttons/run?pageId=${encodeURIComponent(pageId)}&blockId=${encodeURIComponent(block.id)}`,
        ),
      );
      setRun(body.run);
    } catch {
      // A status line that cannot load stays as it was.
    }
  }, [client, pageId, block.id]);

  useEffect(() => {
    if (block.mode === "agent") void loadRun();
  }, [block.mode, loadRun]);

  useEffect(() => {
    if (!isLive(run)) return;
    const timer = setInterval(() => void loadRun(), POLL_MS);
    return () => clearInterval(timer);
  }, [run, loadRun]);

  const press = async () => {
    setPending(true);
    try {
      // The server reads the button and the page as they are stored.
      await flushWorkspace();
      const response = buttonRunResponseSchema.parse(
        await client.post("workspace/buttons/run", {
          pageId,
          blockId: block.id,
        }),
      );
      if (response.mode === "agent") {
        setRun(response.run);
      } else {
        summarise(
          response.results,
          (url) => {
            if (url.startsWith("/")) void platform.navigate(url);
            else void platform.openExternal(url);
          },
          (id) => void platform.navigate(pageHref(id)),
        );
      }
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Button failed");
    } finally {
      setPending(false);
    }
  };

  const empty =
    block.mode === "agent"
      ? !block.agentPrompt.trim()
      : block.actions.length === 0;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-0.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || empty}
        onClick={() => void press()}
        contentEditable={false}
      >
        {block.mode === "agent" ? <Bot /> : null}
        {block.label || "Button"}
      </Button>
      {block.mode === "agent" && run ? <RunStatus run={run} /> : null}
      {editable && (selected || empty) ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Edit button"
          onClick={() => setEditing(true)}
        >
          <Settings2 />
        </Button>
      ) : null}
      {editable ? (
        <ButtonDialog
          open={editing}
          onOpenChange={setEditing}
          block={block}
          pageId={pageId}
          onSave={onChange}
        />
      ) : null}
    </div>
  );
}
