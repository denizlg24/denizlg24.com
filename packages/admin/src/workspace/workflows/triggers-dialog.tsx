"use client";

import {
  DOMAIN_EVENT_FIELDS,
  DOMAIN_EVENT_TYPES,
  type DomainEventRecord,
  type DomainEventType,
  domainEventRecordSchema,
  type EventFieldType,
  TRIGGER_CONDITIONS_MAX,
  TRIGGER_OPS_BY_TYPE,
  type TriggerCondition,
  type TriggerFilterOp,
  type TriggerInput,
  type WorkflowAction,
  type WorkspaceTrigger,
  workspaceTriggerSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { NativeSelect, NativeSelectOption } from "@repo/ui/native-select";
import { SectionLabel } from "@repo/ui/section";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { StatusDot } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { formatDistanceToNowStrict, parseISO } from "date-fns";
import { Plus, Trash2, X, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAdmin } from "../../provider";
import { ActionListEditor } from "./action-editor";

export const EVENT_LABELS: Record<DomainEventType, string> = {
  "kanban.card.created": "Card created",
  "kanban.card.moved": "Card moved",
  "calendar.event.created": "Event created",
  "email.triaged": "Email triaged",
  "finance.payout.landed": "Payout landed",
  "voice-note.transcribed": "Voice note transcribed",
  "workspace.page.created": "Page created",
  "schedule.tick": "Schedule",
};

const OP_LABELS: Record<TriggerFilterOp, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  not_contains: "does not contain",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

const listSchema = z.object({ triggers: z.array(workspaceTriggerSchema) });
const eventsSchema = z.object({ events: z.array(domainEventRecordSchema) });
const triggerResponseSchema = z.object({ trigger: workspaceTriggerSchema });

function ago(iso: string): string {
  return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
}

function fieldsOf(event: DomainEventType): [string, EventFieldType][] {
  return Object.entries(DOMAIN_EVENT_FIELDS[event]);
}

function defaultCondition(event: DomainEventType): TriggerCondition | null {
  const [first] = fieldsOf(event);
  if (!first) return null;
  const [field, type] = first;
  return {
    field,
    op: TRIGGER_OPS_BY_TYPE[type][0] ?? "eq",
    value: type === "number" ? 0 : type === "boolean" ? true : "",
  };
}

function ConditionRow({
  event,
  condition,
  onChange,
  onRemove,
  index,
}: {
  event: DomainEventType;
  condition: TriggerCondition;
  onChange: (condition: TriggerCondition) => void;
  onRemove: () => void;
  index: number;
}) {
  const fields = fieldsOf(event);
  const type: EventFieldType =
    fields.find(([name]) => name === condition.field)?.[1] ?? "string";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        aria-label={`Condition ${index + 1} field`}
        size="sm"
        value={condition.field}
        onChange={(e) => {
          const nextType =
            fields.find(([name]) => name === e.target.value)?.[1] ?? "string";
          onChange({
            field: e.target.value,
            op: TRIGGER_OPS_BY_TYPE[nextType][0] ?? "eq",
            value:
              nextType === "number" ? 0 : nextType === "boolean" ? true : "",
          });
        }}
      >
        {fields.map(([name]) => (
          <NativeSelectOption key={name} value={name}>
            {name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label={`Condition ${index + 1} operator`}
        size="sm"
        value={condition.op}
        onChange={(e) => {
          const op = TRIGGER_OPS_BY_TYPE[type].find(
            (o) => o === e.target.value,
          );
          if (op) onChange({ ...condition, op });
        }}
      >
        {TRIGGER_OPS_BY_TYPE[type].map((op) => (
          <NativeSelectOption key={op} value={op}>
            {OP_LABELS[op]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {type === "boolean" ? (
        <NativeSelect
          aria-label={`Condition ${index + 1} value`}
          size="sm"
          value={String(condition.value)}
          onChange={(e) =>
            onChange({ ...condition, value: e.target.value === "true" })
          }
        >
          <NativeSelectOption value="true">true</NativeSelectOption>
          <NativeSelectOption value="false">false</NativeSelectOption>
        </NativeSelect>
      ) : (
        <Input
          aria-label={`Condition ${index + 1} value`}
          className="h-8 w-48"
          type={type === "number" ? "number" : "text"}
          value={String(condition.value)}
          onChange={(e) =>
            onChange({
              ...condition,
              value:
                type === "number"
                  ? Number(e.target.value) || 0
                  : e.target.value,
            })
          }
        />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Remove condition"
        onClick={onRemove}
      >
        <X />
      </Button>
    </div>
  );
}

const EMPTY: Pick<
  WorkspaceTrigger,
  "name" | "event" | "filter" | "schedule" | "action" | "maxPerHour"
> = {
  name: "",
  event: "kanban.card.moved",
  filter: [],
  schedule: null,
  action: { kind: "actions", actions: [] },
  maxPerHour: 10,
};

function TriggerDialog({
  open,
  onOpenChange,
  trigger,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: WorkspaceTrigger | null;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { client } = useAdmin();
  const [name, setName] = useState("");
  const [event, setEvent] = useState<DomainEventType>("kanban.card.moved");
  const [filter, setFilter] = useState<TriggerCondition[]>([]);
  const [cron, setCron] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [kind, setKind] = useState<"actions" | "agent">("actions");
  const [actions, setActions] = useState<WorkflowAction[]>([]);
  const [prompt, setPrompt] = useState("");
  const [maxPerHour, setMaxPerHour] = useState(10);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    const source = trigger ?? EMPTY;
    setName(source.name);
    setEvent(source.event);
    setFilter(source.filter);
    setCron(source.schedule?.cron ?? "0 7 * * *");
    setTimeZone(
      source.schedule?.timeZone ??
        Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    setKind(source.action.kind);
    setActions(source.action.kind === "actions" ? source.action.actions : []);
    setPrompt(source.action.kind === "agent" ? source.action.prompt : "");
    setMaxPerHour(source.maxPerHour);
  }, [open, trigger]);

  const body: TriggerInput = {
    name,
    event,
    filter: event === "schedule.tick" ? [] : filter,
    schedule: event === "schedule.tick" ? { cron, timeZone } : null,
    action: kind === "agent" ? { kind, prompt } : { kind: "actions", actions },
    maxPerHour,
  };
  const ready =
    name.trim() !== "" &&
    (kind === "agent" ? prompt.trim() !== "" : actions.length > 0);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={trigger ? "Trigger" : "New trigger"}
      size="lg"
      submitDisabled={!ready}
      pending={pending}
      onSubmit={async () => {
        setPending(true);
        try {
          if (trigger) {
            await client.patch(
              `workspace/triggers/${encodeURIComponent(trigger.id)}`,
              body,
            );
          } else {
            triggerResponseSchema.parse(
              await client.post("workspace/triggers", body),
            );
          }
          onSaved();
          onOpenChange(false);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Save failed");
        } finally {
          setPending(false);
        }
      }}
      footerStart={
        trigger ? (
          <ConfirmButton
            title="Delete trigger"
            actionLabel="Delete"
            destructive
            onConfirm={async () => {
              await client.del(
                `workspace/triggers/${encodeURIComponent(trigger.id)}`,
              );
              onDeleted();
              onOpenChange(false);
            }}
            trigger={
              <Button type="button" variant="ghost" size="sm">
                <Trash2 />
                Delete
              </Button>
            }
          />
        ) : null
      }
    >
      <FormGrid>
        <FormField label="Name" htmlFor="trigger-name">
          <Input
            id="trigger-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField label="When" htmlFor="trigger-event">
          <NativeSelect
            id="trigger-event"
            className="w-full"
            value={event}
            onChange={(e) => {
              const next = DOMAIN_EVENT_TYPES.find((t) => t === e.target.value);
              if (!next) return;
              setEvent(next);
              setFilter([]);
            }}
          >
            {DOMAIN_EVENT_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {EVENT_LABELS[type]}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </FormField>
        {event === "schedule.tick" ? (
          <>
            <FormField label="Cron" htmlFor="trigger-cron">
              <Input
                id="trigger-cron"
                className="font-mono"
                value={cron}
                onChange={(e) => setCron(e.target.value)}
              />
            </FormField>
            <FormField label="Time zone" htmlFor="trigger-zone">
              <Input
                id="trigger-zone"
                value={timeZone}
                onChange={(e) => setTimeZone(e.target.value)}
              />
            </FormField>
          </>
        ) : null}
        <FormField label="Per hour" htmlFor="trigger-rate">
          <Input
            id="trigger-rate"
            type="number"
            min={1}
            max={60}
            value={maxPerHour}
            onChange={(e) =>
              setMaxPerHour(
                Math.min(60, Math.max(1, Number(e.target.value) || 1)),
              )
            }
          />
        </FormField>
      </FormGrid>
      {event !== "schedule.tick" ? (
        <div className="flex flex-col gap-2">
          <SectionLabel>If</SectionLabel>
          {filter.map((condition, index) => (
            <ConditionRow
              key={index}
              index={index}
              event={event}
              condition={condition}
              onChange={(next) =>
                setFilter(filter.map((c, i) => (i === index ? next : c)))
              }
              onRemove={() => setFilter(filter.filter((_, i) => i !== index))}
            />
          ))}
          {filter.length < TRIGGER_CONDITIONS_MAX ? (
            <div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  const next = defaultCondition(event);
                  if (next) setFilter([...filter, next]);
                }}
              >
                <Plus />
                Condition
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-col gap-3">
        <SectionLabel>Then</SectionLabel>
        <SegmentedControl
          ariaLabel="Then"
          className="w-fit"
          value={kind}
          options={[
            { value: "actions", label: "Actions" },
            { value: "agent", label: "Agent" },
          ]}
          onValueChange={setKind}
        />
        {kind === "agent" ? (
          <Textarea
            aria-label="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="min-h-32"
          />
        ) : (
          <ActionListEditor
            actions={actions}
            onChange={setActions}
            hostPageId={null}
          />
        )}
      </div>
    </FormDialog>
  );
}

function firingSummary(event: DomainEventRecord): string {
  const counts = new Map<string, number>();
  for (const firing of event.firings) {
    counts.set(firing.outcome, (counts.get(firing.outcome) ?? 0) + 1);
  }
  return [...counts]
    .map(
      ([outcome, count]) => `${count} ${outcome.replace("skipped-", "skip ")}`,
    )
    .join(" · ");
}

/** Every trigger, terse, and the events that came through lately. */
export function TriggersDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { client } = useAdmin();
  const [triggers, setTriggers] = useState<WorkspaceTrigger[] | null>(null);
  const [events, setEvents] = useState<DomainEventRecord[]>([]);
  const [editing, setEditing] = useState<WorkspaceTrigger | null>(null);
  const [dialog, setDialog] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, recent] = await Promise.all([
        client.get("workspace/triggers"),
        client.get("workspace/triggers/events?limit=20"),
      ]);
      setTriggers(listSchema.parse(list).triggers);
      setEvents(eventsSchema.parse(recent).events);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Load failed");
      setTriggers((current) => current ?? []);
    }
  }, [client]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = async (trigger: WorkspaceTrigger, enabled: boolean) => {
    setTriggers(
      (current) =>
        current?.map((t) => (t.id === trigger.id ? { ...t, enabled } : t)) ??
        null,
    );
    try {
      await client.patch(
        `workspace/triggers/${encodeURIComponent(trigger.id)}`,
        { enabled },
      );
    } finally {
      await load();
    }
  };

  const names = new Map((triggers ?? []).map((t) => [t.id, t.name]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        className="flex h-[min(85vh,60rem)] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="flex shrink-0 items-center gap-2 border-b px-5 pt-4 pb-3 pr-12">
          <Zap className="size-4 text-muted-foreground" />
          <DialogTitle className="flex-1">Triggers</DialogTitle>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 content-start gap-8 overflow-y-auto overscroll-contain px-5 py-5 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1">
            <SectionLabel>Triggers</SectionLabel>
            {triggers === null ? null : triggers.length === 0 ? (
              <EmptyState compact icon={<Zap />} label="No triggers" />
            ) : (
              <List>
                {triggers.map((trigger) => (
                  <ListRow
                    key={trigger.id}
                    onClick={() => {
                      setEditing(trigger);
                      setDialog(true);
                    }}
                    leading={
                      <StatusDot
                        tone={
                          trigger.disabledReason
                            ? "critical"
                            : trigger.enabled
                              ? "good"
                              : "muted"
                        }
                        label={
                          trigger.disabledReason
                            ? "Turned off"
                            : trigger.enabled
                              ? "On"
                              : "Off"
                        }
                      />
                    }
                    title={trigger.name}
                    description={
                      trigger.disabledReason ??
                      `${EVENT_LABELS[trigger.event]}${trigger.filter.length ? ` · ${trigger.filter.length} if` : ""} · ${trigger.action.kind === "agent" ? "agent" : `${trigger.action.actions.length} actions`}`
                    }
                    meta={
                      trigger.lastFiredAt ? (
                        <span
                          className={
                            trigger.lastResult?.ok === false
                              ? "text-status-critical"
                              : undefined
                          }
                        >
                          {ago(trigger.lastFiredAt)}
                        </span>
                      ) : null
                    }
                    trailing={
                      <Switch
                        aria-label={`${trigger.name} on`}
                        checked={trigger.enabled}
                        onCheckedChange={(enabled) =>
                          void toggle(trigger, enabled)
                        }
                      />
                    }
                  />
                ))}
              </List>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <SectionLabel>Events</SectionLabel>
            {events.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <List>
                {events.map((event) => (
                  <ListRow
                    key={event.id}
                    title={EVENT_LABELS[event.type]}
                    description={
                      event.firings.length > 0
                        ? event.firings
                            .map(
                              (f) =>
                                `${names.get(f.triggerId) ?? "deleted"}: ${f.outcome}`,
                            )
                            .join(" · ")
                        : String(
                            event.payload.title ??
                              event.payload.subject ??
                              event.payload.ruleName ??
                              "",
                          )
                    }
                    meta={
                      <>
                        {event.firings.length > 0 ? firingSummary(event) : null}
                        <span>{ago(event.at)}</span>
                      </>
                    }
                  />
                ))}
              </List>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 border-t px-5 py-3">
          <span className="flex-1 text-xs tabular-nums text-muted-foreground">
            {triggers
              ? `${triggers.filter((t) => t.enabled).length}/${triggers.length} on`
              : null}
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setDialog(true);
            }}
          >
            <Plus />
            New
          </Button>
        </div>
        <TriggerDialog
          open={dialog}
          onOpenChange={setDialog}
          trigger={editing}
          onSaved={() => void load()}
          onDeleted={() => void load()}
        />
      </DialogContent>
    </Dialog>
  );
}
