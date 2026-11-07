"use client";

import type {
  CreateSprintSlotInput,
  RunConfigOverride,
  Sprint,
  SprintSlot,
  SprintSlotKind,
  UpdateSprintSlot,
} from "@repo/schemas";
import {
  DEFAULT_UPSTREAM_WAIT_MINUTES,
  SPRINT_SLOT_KINDS,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { DateTimePicker } from "@repo/ui/date-time-picker";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { OptionSelect } from "@repo/ui/option-select";
import { SectionLabel } from "@repo/ui/section";
import { Textarea } from "@repo/ui/textarea";
import { ExternalLink, Play, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { isRunConfigComplete, RunConfigFields } from "./run-config-fields";
import {
  apiErrorCode,
  canRetrySlot,
  errorMessage,
  formatAbsolute,
  fromLocalInput,
  isEditableSlotStatus,
  isLiveSlotStatus,
  SLOT_KIND_LABEL,
  SLOT_STATUS_BADGE,
  toLocalInput,
} from "./sprint-meta";

const KIND_OPTIONS = SPRINT_SLOT_KINDS.map((kind) => ({
  value: kind,
  label: SLOT_KIND_LABEL[kind],
}));

interface Draft {
  kind: SprintSlotKind;
  at: string;
  title: string;
  task: string;
  /** `null` until touched on a new slot: the server picks the previous one. */
  dependsOn: string[] | null;
  waitMinutes: string;
  config: RunConfigOverride;
}

function draftOf(slot: SprintSlot | null, at: Date): Draft {
  return {
    kind: slot?.kind ?? "implement",
    at: toLocalInput(slot ? new Date(slot.at) : at),
    title: slot?.title ?? "",
    task: slot?.task ?? "",
    dependsOn: slot ? slot.dependsOn : null,
    waitMinutes: String(
      slot?.onUpstreamRunning.waitMinutes ?? DEFAULT_UPSTREAM_WAIT_MINUTES,
    ),
    config: slot?.config ?? {},
  };
}

/** The slot before `at` in time, which is what the server defaults to. */
function previousSlotId(slots: SprintSlot[], at: Date | null): string | null {
  if (!at) return null;
  let best: SprintSlot | null = null;
  for (const slot of slots) {
    const time = new Date(slot.at).getTime();
    if (time > at.getTime()) continue;
    if (!best || time >= new Date(best.at).getTime()) best = slot;
  }
  return best?.id ?? null;
}

/** Mounted per slot: the draft is taken from props once, so polling never clobbers an edit. */
export function SlotDialog({
  open,
  sprint,
  slots,
  slot,
  initialAt,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  sprint: Sprint;
  slots: SprintSlot[];
  slot: SprintSlot | null;
  initialAt: Date;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { client, routes } = useAdmin();
  const [draft, setDraft] = useState<Draft>(() => draftOf(slot, initialAt));
  const [pending, setPending] = useState(false);

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const others = useMemo(
    () =>
      slots
        .filter((candidate) => candidate.id !== slot?.id)
        .sort((left, right) => left.at.localeCompare(right.at)),
    [slots, slot?.id],
  );

  const at = fromLocalInput(draft.at);
  const fallbackUpstream = previousSlotId(others, at);
  const dependsOn =
    draft.dependsOn ?? (fallbackUpstream ? [fallbackUpstream] : []);
  const wait = Number(draft.waitMinutes);
  const locked =
    slot !== null &&
    !isEditableSlotStatus(slot.status) &&
    !canRetrySlot(slot.status);
  const live = slot !== null && isLiveSlotStatus(slot.status);
  const valid =
    at !== null &&
    draft.waitMinutes.trim() !== "" &&
    Number.isInteger(wait) &&
    wait >= 0 &&
    isRunConfigComplete(draft.config);

  const toggleUpstream = (id: string, checked: boolean) =>
    set({
      dependsOn: checked
        ? [...dependsOn.filter((other) => other !== id), id]
        : dependsOn.filter((other) => other !== id),
    });

  const act = async (work: () => Promise<unknown>, close = true) => {
    setPending(true);
    try {
      await work();
      await onChanged();
      if (close) onOpenChange(false);
    } catch (error) {
      toast.error(
        apiErrorCode(error) === "CYCLE"
          ? "Dependency cycle"
          : errorMessage(error, "Request failed"),
      );
    } finally {
      setPending(false);
    }
  };

  const submit = () =>
    act(async () => {
      if (!at) return;
      const title = draft.title.trim() || SLOT_KIND_LABEL[draft.kind];
      const onUpstreamRunning = { waitMinutes: wait };
      if (slot) {
        const body: UpdateSprintSlot = {
          at: at.toISOString(),
          kind: draft.kind,
          title,
          task: draft.task,
          config: draft.config,
          dependsOn,
          onUpstreamRunning,
        };
        await client.patch(`sprints/${sprint.id}/slots/${slot.id}`, body);
      } else {
        const body: CreateSprintSlotInput = {
          at: at.toISOString(),
          kind: draft.kind,
          title,
          task: draft.task,
          config: draft.config,
          onUpstreamRunning,
          ...(draft.dependsOn ? { dependsOn: draft.dependsOn } : {}),
        };
        await client.post(`sprints/${sprint.id}/slots`, body);
      }
    });

  const slotPath = slot ? `sprints/${sprint.id}/slots/${slot.id}` : null;

  const footerStart = slot ? (
    <>
      {!live ? (
        <ConfirmButton
          trigger={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Delete"
              className="text-destructive"
              disabled={pending}
            >
              <Trash2 />
            </Button>
          }
          title={`Delete “${slot.title}”?`}
          actionLabel="Delete"
          destructive
          onConfirm={() => act(() => client.del(slotPath ?? ""))}
        />
      ) : null}
      {isEditableSlotStatus(slot.status) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => act(() => client.post(`${slotPath}/run-now`))}
        >
          <Play /> Run now
        </Button>
      ) : null}
      {canRetrySlot(slot.status) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => act(() => client.post(`${slotPath}/retry`))}
        >
          <RotateCcw /> Retry
        </Button>
      ) : null}
      {slot.lastRunId ? (
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link href={routes.sprints.run(slot.lastRunId)}>
            <ExternalLink /> Run
          </Link>
        </Button>
      ) : null}
    </>
  ) : null;

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={
        slot ? (
          <span className="flex items-center gap-2">
            {slot.title}
            <Badge variant={SLOT_STATUS_BADGE[slot.status]}>
              {slot.status}
            </Badge>
            {slot.skipReason ? (
              <span className="text-xs font-normal text-muted-foreground">
                {slot.skipReason}
              </span>
            ) : null}
          </span>
        ) : (
          "New slot"
        )
      }
      submitLabel={slot ? "Save" : "Add"}
      submitDisabled={!valid || locked || live}
      pending={pending}
      onSubmit={submit}
      footerStart={footerStart}
    >
      <FormGrid>
        <FormField label="Kind">
          <OptionSelect<SprintSlotKind>
            size="default"
            className="w-full"
            aria-label="Kind"
            disabled={locked || live}
            value={draft.kind}
            options={KIND_OPTIONS}
            onValueChange={(kind) => kind && set({ kind })}
          />
        </FormField>
        <FormField label="Time">
          <DateTimePicker
            value={draft.at}
            disabled={locked || live}
            onValueChange={(value) => value && set({ at: value })}
          />
        </FormField>
        <FormField label="Title" className="sm:col-span-2">
          <Input
            value={draft.title}
            placeholder={SLOT_KIND_LABEL[draft.kind]}
            disabled={locked || live}
            onChange={(event) => set({ title: event.target.value })}
          />
        </FormField>
        <FormField label="Task" className="sm:col-span-2">
          <Textarea
            value={draft.task}
            rows={8}
            disabled={locked || live}
            className="min-h-40 resize-y font-mono text-xs md:text-xs"
            onChange={(event) => set({ task: event.target.value })}
          />
        </FormField>
        <FormField label="Upstream wait (min)">
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            value={draft.waitMinutes}
            disabled={locked || live}
            className="tabular-nums"
            onChange={(event) => set({ waitMinutes: event.target.value })}
          />
        </FormField>
      </FormGrid>

      <div className="flex flex-col gap-2">
        <SectionLabel count={dependsOn.length}>Depends on</SectionLabel>
        {others.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <div className="flex flex-col">
            {others.map((other) => {
              const id = `upstream-${other.id}`;
              return (
                <label
                  key={other.id}
                  htmlFor={id}
                  className="-mx-2 flex min-h-8 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-surface/70"
                >
                  <Checkbox
                    id={id}
                    checked={dependsOn.includes(other.id)}
                    disabled={locked || live}
                    onCheckedChange={(checked) =>
                      toggleUpstream(other.id, checked === true)
                    }
                  />
                  <span className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {formatAbsolute(other.at)}
                  </span>
                  <span className="w-20 shrink-0 text-xs text-muted-foreground">
                    {SLOT_KIND_LABEL[other.kind]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-accent-strong">
                    {other.title}
                  </span>
                  <Badge variant={SLOT_STATUS_BADGE[other.status]}>
                    {other.status}
                  </Badge>
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <SectionLabel>Run</SectionLabel>
        <RunConfigFields
          value={draft.config}
          inherited={sprint.defaults}
          disabled={locked || live}
          onChange={(patch) => set({ config: { ...draft.config, ...patch } })}
        />
      </div>
    </FormDialog>
  );
}
