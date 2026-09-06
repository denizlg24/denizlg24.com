import { randomUUID } from "node:crypto";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { NativeSelect } from "@repo/ui/native-select";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { ChevronDown, Trash2, TriangleAlert } from "lucide-react";
import { adminAction } from "@/app/admin/actions";
import { Time } from "@/components/time";
import { RESET_PHRASE } from "@/lib/input";
import type { Backup, Incident, Maintenance, Service } from "@/lib/model";

export function Fields({
  operation,
  id = "",
}: {
  operation: string;
  id?: string;
}) {
  return (
    <>
      <input type="hidden" name="operation" value={operation} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="mutationId" value={randomUUID()} />
    </>
  );
}
/** A <details> disclosure with the same hairline summary used across the admin. */
export function Disclosure({
  summary,
  note,
  children,
  className,
}: {
  summary: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details className={cn("group border-b", className)}>
      <summary className="hover:bg-surface/60 flex cursor-pointer list-none items-center gap-2.5 py-3 text-sm [&::-webkit-details-marker]:hidden">
        <ChevronDown
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
        />
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {summary}
        </span>
        {note ? (
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {note}
          </span>
        ) : null}
      </summary>
      <div className="space-y-4 pb-5 pl-6">{children}</div>
    </details>
  );
}
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground/80">{hint}</p> : null}
    </div>
  );
}
export function Log({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-surface/60 max-h-64 overflow-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap text-muted-foreground">
      {children}
    </pre>
  );
}
function ServiceSelect({
  services,
  selected = [],
}: {
  services: Service[];
  selected?: string[];
}) {
  return (
    <Field
      label="Affected services"
      hint="Use Command / Ctrl to select more than one."
    >
      <select
        name="serviceIds"
        multiple
        required
        defaultValue={selected}
        size={Math.min(8, Math.max(4, services.length))}
        className="border-border focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px]"
      >
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function NewIncident({ services }: { services: Service[] }) {
  return (
    <Disclosure
      summary={<span className="font-medium">Publish an incident</span>}
    >
      <form action={adminAction} className="max-w-xl space-y-4">
        <Fields operation="incident-create" />
        <Field label="Public title">
          <Input
            name="title"
            required
            maxLength={160}
            placeholder="Storage uploads are delayed"
          />
        </Field>
        <ServiceSelect services={services} />
        <Field label="Initial public update">
          <Textarea
            name="text"
            required
            rows={4}
            maxLength={4000}
            placeholder="What users are experiencing and what you know so far."
          />
        </Field>
        <Button type="submit" size="sm">
          Publish incident
        </Button>
      </form>
    </Disclosure>
  );
}
export function IncidentControls({ incident }: { incident: Incident }) {
  const upstream = incident.betterStackId ? " in Better Stack" : "";
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!incident.acknowledgedAt && !incident.resolvedAt ? (
          <form action={adminAction}>
            <Fields operation="incident-acknowledge" id={incident._id} />
            <Button type="submit" size="sm" variant="outline">
              Acknowledge{upstream}
            </Button>
          </form>
        ) : null}
        {!incident.resolvedAt ? (
          <form action={adminAction}>
            <Fields operation="incident-resolve" id={incident._id} />
            <Button type="submit" size="sm" variant="outline">
              Resolve{upstream}
            </Button>
          </form>
        ) : null}
      </div>
      <form action={adminAction} className="max-w-xl space-y-4">
        <Fields operation="incident-update" id={incident._id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Visibility">
            <NativeSelect
              name="visibility"
              defaultValue="private"
              className="w-full"
            >
              <option value="private">Admin only</option>
              <option value="public">Public status page</option>
            </NativeSelect>
          </Field>
          <Field label="Investigation state">
            <NativeSelect
              name="state"
              defaultValue={incident.resolvedAt ? "resolved" : "investigating"}
              className="w-full"
            >
              <option value="investigating">Investigating</option>
              <option value="identified">Cause confirmed</option>
              <option value="monitoring">Monitoring recovery</option>
              {incident.resolvedAt ? (
                <option value="resolved">Resolved</option>
              ) : null}
            </NativeSelect>
          </Field>
        </div>
        <Field
          label="Update"
          hint={
            incident.betterStackId
              ? "Also attached to the Better Stack incident. Public notes are visible to everyone."
              : "Public notes are visible to everyone."
          }
        >
          <Textarea name="text" required rows={3} maxLength={4000} />
        </Field>
        <Button type="submit" size="sm" variant="outline">
          Post update
        </Button>
      </form>
    </>
  );
}
export function MaintenanceForm({
  services,
  window,
}: {
  services: Service[];
  window?: Maintenance;
}) {
  return (
    <form action={adminAction} className="max-w-xl space-y-4">
      <Fields operation="maintenance-save" id={window?._id} />
      <Field label="Public title">
        <Input
          name="title"
          defaultValue={window?.title}
          required
          maxLength={160}
        />
      </Field>
      <Field label="Expected impact">
        <Textarea
          name="description"
          defaultValue={window?.description}
          required
          rows={3}
          maxLength={4000}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts (UTC)">
          <Input
            name="startsAt"
            type="datetime-local"
            defaultValue={window?.startsAt.slice(0, 16)}
            required
          />
        </Field>
        <Field label="Ends (UTC)">
          <Input
            name="endsAt"
            type="datetime-local"
            defaultValue={window?.endsAt.slice(0, 16)}
            required
          />
        </Field>
      </div>
      <ServiceSelect services={services} selected={window?.serviceIds} />
      <Button type="submit" size="sm">
        {window ? "Save maintenance" : "Schedule maintenance"}
      </Button>
    </form>
  );
}
/**
 * Uptime percentages are only meaningful from the moment the page is real. This
 * clears what was measured while it was being built; it cannot be undone, which
 * is why the phrase has to be typed rather than a button merely pressed.
 */
export function ResetHistory() {
  return (
    <Disclosure
      summary={
        <span className="flex items-center gap-2 font-medium text-destructive">
          <TriangleAlert aria-hidden className="size-3.5" />
          Reset collected history
        </span>
      }
    >
      <form action={adminAction} className="max-w-xl space-y-4">
        <Fields operation="history-reset" />
        <Field
          label="What to clear"
          hint="Service definitions, Better Stack bindings, backups and the current reading are all kept — only the measured record is removed."
        >
          <NativeSelect name="scope" defaultValue="history" className="w-full">
            <option value="history">
              Uptime history — samples, daily rollups, response timings
            </option>
            <option value="history-and-incidents">
              Uptime history, plus incidents and maintenance windows
            </option>
          </NativeSelect>
        </Field>
        <Field label={`Type ${RESET_PHRASE} to confirm`}>
          <Input
            name="confirm"
            required
            autoComplete="off"
            placeholder={RESET_PHRASE}
            className="font-mono"
          />
        </Field>
        <Button type="submit" size="sm" variant="destructive">
          <Trash2 aria-hidden />
          Clear history permanently
        </Button>
      </form>
    </Disclosure>
  );
}
export function BackupControls({ backup }: { backup: Backup }) {
  const dr = backup.provider === "dr";
  const identity = (
    <>
      <input type="hidden" name="profile" value={backup.profile ?? ""} />
      <input type="hidden" name="job" value={backup.job ?? ""} />
    </>
  );
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <form action={adminAction}>
          <Fields operation={dr ? "dr-command" : "backup-run"} id={backup.id} />
          {identity}
          <input type="hidden" name="action" value="run" />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            disabled={
              backup.status === "running" || backup.status === "pending"
            }
          >
            Run now
          </Button>
        </form>
        <span className="text-xs text-muted-foreground">
          Last report: <Time value={backup.reportedAt || null} />
        </span>
      </div>
      <form action={adminAction} className="max-w-xl space-y-4">
        <Fields
          operation={dr ? "dr-command" : "backup-schedule"}
          id={backup.id}
        />
        {identity}
        <input type="hidden" name="action" value="schedule" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              dr
                ? backup.profile === "mac"
                  ? "Interval (seconds)"
                  : "Systemd calendar (include UTC)"
                : "Cron expression (Cloud scheduler timezone)"
            }
          >
            <Input
              name="schedule"
              defaultValue={backup.schedule ?? ""}
              required
              maxLength={160}
              placeholder={dr ? "*-*-* 05:17:00 UTC" : "0 3 * * *"}
              className="font-mono"
            />
          </Field>
          <Field label="Scheduled runs">
            <NativeSelect
              name="enabled"
              defaultValue={String(backup.enabled)}
              className="w-full"
            >
              <option value="true">Enabled</option>
              <option value="false">Paused</option>
            </NativeSelect>
          </Field>
        </div>
        <Button type="submit" size="sm" variant="outline">
          Save schedule
        </Button>
      </form>
    </>
  );
}
