"use client";

import type {
  CodingRunSummary,
  RunConfig,
  RunConfigOverride,
  Sprint,
  SprintDetail,
  SprintSlot,
} from "@repo/schemas";
import { isLiveCodingRunStatus } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton, ConfirmDialog } from "@repo/ui/confirm-button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Page, PageBody, PageHeader, PageTitle } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { StatusDot } from "@repo/ui/status-dot";
import { RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import {
  Ban,
  GitMerge,
  GitPullRequest,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { formatCost } from "../agent/agent-parts";
import { AdminApiError } from "../client";
import { useAdmin } from "../provider";
import { isRunConfigComplete, RunConfigFields } from "./run-config-fields";
import { SlotDialog } from "./slot-dialog";
import { SprintDialog } from "./sprint-dialog";
import {
  errorMessage,
  FAILURE_LABEL,
  formatAbsolute,
  githubUrl,
  isLiveSlotStatus,
  RUN_STATUS_TONE,
  SLOT_KIND_LABEL,
  SPRINT_STATUS_BADGE,
} from "./sprint-meta";
import { SprintTimeline } from "./sprint-timeline";
import { SPRINT_ICON } from "./sprints-page";

const LIVE_POLL_MS = 5_000;

function needsPolling(detail: SprintDetail): boolean {
  return (
    detail.runs.some((run) => isLiveCodingRunStatus(run.status)) ||
    detail.slots.some(
      (slot) => isLiveSlotStatus(slot.status) || slot.status === "waiting",
    ) ||
    detail.sprint.release?.state === "merging"
  );
}

function nextHour(): Date {
  const at = new Date();
  at.setHours(at.getHours() + 1, 0, 0, 0);
  return at;
}

export function SprintSkeleton() {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={SPRINT_ICON}
        title="Sprint"
      />
      <PageBody width="wide">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-2/5" />
          <Skeleton className="h-3 w-1/3" />
        </div>
        <Skeleton className="h-96 w-full" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

function RunRow({
  run,
  slotTitle,
  href,
}: {
  run: CodingRunSummary;
  slotTitle: string | undefined;
  href: string;
}) {
  const router = useRouter();
  const when = run.startedAt ?? run.createdAt;
  return (
    <ListRow
      onClick={() => router.push(href)}
      leading={
        <StatusDot
          tone={RUN_STATUS_TONE[run.status]}
          label={run.status}
          className={cn(run.status === "running" && "animate-pulse")}
        />
      }
      title={slotTitle ?? SLOT_KIND_LABEL[run.kind]}
      description={
        run.failure
          ? `${FAILURE_LABEL[run.failure.code]} · ${run.failure.message}`
          : SLOT_KIND_LABEL[run.kind]
      }
      meta={
        <>
          {run.ci ? <span>CI {run.ci.state}</span> : null}
          {run.usage ? (
            <span>
              {run.usage.notional ? "~" : ""}
              {formatCost(run.usage.costUsd)}
            </span>
          ) : null}
          <span className="w-36 text-right">{formatAbsolute(when)}</span>
        </>
      }
    />
  );
}

function DefaultsSection({
  sprint,
  disabled,
  onSaved,
}: {
  sprint: Sprint;
  disabled: boolean;
  onSaved: (sprint: Sprint) => void;
}) {
  const { client } = useAdmin();
  const [draft, setDraft] = useState<RunConfig>(sprint.defaults);
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(draft) !== JSON.stringify(sprint.defaults);

  const save = async () => {
    setSaving(true);
    try {
      const result = await client.patch<{ sprint: Sprint }>(
        `sprints/${sprint.id}`,
        { defaults: draft },
      );
      onSaved(result.sprint);
    } catch (error) {
      toast.error(errorMessage(error, "Save failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Defaults"
      actions={
        dirty ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() => setDraft(sprint.defaults)}
            >
              Reset
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={saving || !isRunConfigComplete(draft)}
              onClick={() => void save()}
            >
              {saving ? <Spinner /> : null}
              Save
            </Button>
          </>
        ) : null
      }
    >
      <RunConfigFields
        layout="properties"
        value={draft}
        disabled={disabled}
        onChange={(patch: RunConfigOverride) =>
          setDraft((current) => ({ ...current, ...patch }))
        }
      />
    </Section>
  );
}

export function SprintPage({ sprintId }: { sprintId: string }) {
  const { client, routes, slots: adminSlots } = useAdmin();
  const router = useRouter();
  const [detail, setDetail] = useState<SprintDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [slotDialog, setSlotDialog] = useState<{
    slot: SprintSlot | null;
    at: Date;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await client.get<SprintDetail>(`sprints/${sprintId}`);
      setDetail(result);
    } catch (error) {
      if (error instanceof AdminApiError && error.code === 404) {
        setMissing(true);
        return;
      }
      toast.error(errorMessage(error, "Failed to load sprint"));
    }
  }, [client, sprintId]);

  useEffect(() => {
    void load();
  }, [load]);

  const polling = detail ? needsPolling(detail) : false;
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => void load(), LIVE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [polling, load]);

  const slotTitles = useMemo(
    () => new Map(detail?.slots.map((slot) => [slot.id, slot.title]) ?? []),
    [detail?.slots],
  );
  const runs = useMemo(
    () =>
      [...(detail?.runs ?? [])].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    [detail?.runs],
  );

  if (missing) {
    return (
      <Page>
        <PageHeader
          leading={adminSlots?.sidebarTrigger}
          crumbs={[
            {
              label: "Sprints",
              onClick: () => router.push(routes.sprints.root),
            },
          ]}
          icon={SPRINT_ICON}
          title="Sprint"
        />
        <PageBody>
          <EmptyState icon={SPRINT_ICON} label="Not found" />
        </PageBody>
      </Page>
    );
  }
  if (!detail) return <SprintSkeleton />;

  const { sprint, slots } = detail;
  const editable = sprint.status === "draft" || sprint.status === "active";
  const releaseReady = sprint.release?.state === "ready";
  const setSprint = (next: Sprint) =>
    setDetail((current) => (current ? { ...current, sprint: next } : current));

  const act = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(errorMessage(error, "Request failed"));
    } finally {
      setBusy(false);
    }
  };

  const transition = (action: "activate" | "cancel" | "merge") =>
    act(async () => {
      const result = await client.post<{ sprint: Sprint }>(
        `sprints/${sprint.id}/${action}`,
      );
      setSprint(result.sprint);
      await load();
    });

  const remove = () =>
    act(async () => {
      await client.del(`sprints/${sprint.id}`);
      router.push(routes.sprints.root);
    });

  const moveSlot = async (slot: SprintSlot, at: Date) => {
    const iso = at.toISOString();
    setDetail((current) =>
      current
        ? {
            ...current,
            slots: current.slots.map((candidate) =>
              candidate.id === slot.id ? { ...candidate, at: iso } : candidate,
            ),
          }
        : current,
    );
    try {
      await client.patch(`sprints/${sprint.id}/slots/${slot.id}`, { at: iso });
    } catch (error) {
      toast.error(errorMessage(error, "Move failed"));
    }
    await load();
  };

  return (
    <Page>
      <PageHeader
        leading={adminSlots?.sidebarTrigger}
        crumbs={[
          { label: "Sprints", onClick: () => router.push(routes.sprints.root) },
        ]}
        icon={SPRINT_ICON}
        title={sprint.title}
      >
        {sprint.prUrl ? (
          <Button size="icon-sm" variant="ghost" asChild>
            <a
              href={sprint.prUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Pull request"
            >
              <GitPullRequest />
            </a>
          </Button>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Edit"
          onClick={() => setEditing(true)}
        >
          <Pencil />
        </Button>
        {editable ? (
          <ConfirmButton
            trigger={
              <Button size="sm" variant="ghost" disabled={busy}>
                <Ban /> Cancel
              </Button>
            }
            title={`Cancel “${sprint.title}”?`}
            actionLabel="Cancel sprint"
            destructive
            onConfirm={() => transition("cancel")}
          />
        ) : null}
        {releaseReady ? (
          <ConfirmButton
            trigger={
              <Button size="sm" disabled={busy}>
                {busy ? <Spinner /> : <GitMerge />}
                Merge
              </Button>
            }
            title={`Merge #${sprint.prNumber ?? ""}?`}
            description={
              <span className="font-mono">
                {sprint.release?.sha.slice(0, 7)}
              </span>
            }
            actionLabel="Merge"
            onConfirm={() => transition("merge")}
          />
        ) : sprint.status === "draft" ? (
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void transition("activate")}
          >
            {busy ? <Spinner /> : <Play />}
            Activate
          </Button>
        ) : null}
        <RowActions>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmDelete(true)}
          >
            <Trash2 /> Delete
          </DropdownMenuItem>
        </RowActions>
      </PageHeader>

      <PageBody width="wide">
        <PageTitle
          title={sprint.title}
          meta={
            <>
              <Badge
                variant={SPRINT_STATUS_BADGE[sprint.status]}
                className="capitalize"
              >
                {sprint.status}
              </Badge>
              <a
                href={githubUrl(sprint.repo, `/tree/${sprint.branch}`)}
                target="_blank"
                rel="noreferrer"
                className="font-mono hover:text-accent-strong hover:underline"
              >
                {sprint.repo}@{sprint.branch}
              </a>
              <span className="font-mono">← {sprint.baseBranch}</span>
              {sprint.prUrl ? (
                <a
                  href={sprint.prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="tabular-nums hover:text-accent-strong hover:underline"
                >
                  #{sprint.prNumber}
                  {sprint.prState ? ` · ${sprint.prState}` : ""}
                </a>
              ) : null}
              {sprint.release ? (
                <span>release {sprint.release.state}</span>
              ) : null}
              <span>{sprint.timeZone}</span>
            </>
          }
        />

        {sprint.goal.trim() ? (
          <MarkdownRenderer content={sprint.goal} className="text-sm" />
        ) : null}

        <Section
          title="Timeline"
          count={slots.length}
          actions={
            editable ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSlotDialog({ slot: null, at: nextHour() })}
              >
                <Plus /> Slot
              </Button>
            ) : null
          }
        >
          <SprintTimeline
            slots={slots}
            editable={editable}
            onCreateAt={(at) => setSlotDialog({ slot: null, at })}
            onOpenSlot={(slot) =>
              setSlotDialog({ slot, at: new Date(slot.at) })
            }
            onMoveSlot={(slot, at) => void moveSlot(slot, at)}
          />
        </Section>

        <Section title="Runs" count={runs.length}>
          {runs.length === 0 ? (
            <span className="text-xs text-muted-foreground">—</span>
          ) : (
            <List>
              {runs.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  slotTitle={slotTitles.get(run.slotId)}
                  href={routes.sprints.run(run.id)}
                />
              ))}
            </List>
          )}
        </Section>

        <DefaultsSection
          key={JSON.stringify(sprint.defaults)}
          sprint={sprint}
          disabled={!editable}
          onSaved={setSprint}
        />
      </PageBody>

      {editing ? (
        <SprintDialog
          open
          sprint={sprint}
          onOpenChange={setEditing}
          onSaved={setSprint}
        />
      ) : null}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${sprint.title}”?`}
        actionLabel="Delete"
        destructive
        pending={busy}
        onConfirm={remove}
      />
      {slotDialog ? (
        <SlotDialog
          key={slotDialog.slot?.id ?? `new-${slotDialog.at.getTime()}`}
          open
          sprint={sprint}
          slots={slots}
          slot={
            slotDialog.slot
              ? (slots.find((slot) => slot.id === slotDialog.slot?.id) ??
                slotDialog.slot)
              : null
          }
          initialAt={slotDialog.at}
          onOpenChange={(open) => {
            if (!open) setSlotDialog(null);
          }}
          onChanged={load}
        />
      ) : null}
    </Page>
  );
}
