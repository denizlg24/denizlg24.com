import { randomUUID } from "node:crypto";
import { adminAction } from "@/app/admin/actions";
import { Time } from "@/components/time";
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
function ServiceSelect({
  services,
  selected = [],
}: {
  services: Service[];
  selected?: string[];
}) {
  return (
    <label className="form-field">
      Affected services
      <select name="serviceIds" multiple required defaultValue={selected}>
        {services.map((service) => (
          <option key={service.id} value={service.id}>
            {service.name}
          </option>
        ))}
      </select>
      <small>Use Command / Ctrl to select more than one service.</small>
    </label>
  );
}
export function NewIncident({ services }: { services: Service[] }) {
  return (
    <details className="diagnostic">
      <summary>
        Publish an incident <span>+</span>
      </summary>
      <form action={adminAction} className="admin-form">
        <Fields operation="incident-create" />
        <label className="form-field">
          Public title
          <input
            name="title"
            required
            maxLength={160}
            placeholder="Storage uploads are delayed"
          />
        </label>
        <ServiceSelect services={services} />
        <label className="form-field">
          Initial public update
          <textarea
            name="text"
            required
            maxLength={4000}
            placeholder="What users are experiencing and what you know so far."
          />
        </label>
        <button className="primary-button">Publish incident</button>
      </form>
    </details>
  );
}
export function IncidentControls({ incident }: { incident: Incident }) {
  return (
    <>
      <div className="form-actions">
        {!incident.acknowledgedAt && !incident.resolvedAt ? (
          <form action={adminAction}>
            <Fields operation="incident-acknowledge" id={incident._id} />
            <button>
              Acknowledge{incident.betterStackId ? " in Better Stack" : ""}
            </button>
          </form>
        ) : null}
        {!incident.resolvedAt ? (
          <form action={adminAction}>
            <Fields operation="incident-resolve" id={incident._id} />
            <button>
              Resolve{incident.betterStackId ? " in Better Stack" : ""}
            </button>
          </form>
        ) : null}
      </div>
      <form action={adminAction} className="admin-form">
        <Fields operation="incident-update" id={incident._id} />
        <div className="form-grid">
          <label className="form-field">
            Visibility
            <select name="visibility" defaultValue="private">
              <option value="private">Admin only</option>
              <option value="public">Public status page</option>
            </select>
          </label>
          <label className="form-field">
            Investigation state
            <select
              name="state"
              defaultValue={incident.resolvedAt ? "resolved" : "investigating"}
            >
              <option value="investigating">Investigating</option>
              <option value="identified">Cause confirmed</option>
              <option value="monitoring">Monitoring recovery</option>
              {incident.resolvedAt ? (
                <option value="resolved">Resolved</option>
              ) : null}
            </select>
          </label>
        </div>
        <label className="form-field">
          Update
          <textarea
            name="text"
            required
            maxLength={4000}
            placeholder="Add observations, a confirmed cause, or a recovery update."
          />
          <small>
            {incident.betterStackId
              ? "The note is also attached to the Better Stack incident. Public notes are visible to everyone on this page."
              : "Public notes are visible to everyone on this page."}
          </small>
        </label>
        <button>Post update</button>
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
    <form action={adminAction} className="admin-form">
      <Fields operation="maintenance-save" id={window?._id} />
      <label className="form-field">
        Public title
        <input
          name="title"
          defaultValue={window?.title}
          required
          maxLength={160}
        />
      </label>
      <label className="form-field">
        Expected impact
        <textarea
          name="description"
          defaultValue={window?.description}
          required
          maxLength={4000}
        />
      </label>
      <div className="form-grid">
        <label className="form-field">
          Starts (UTC)
          <input
            name="startsAt"
            type="datetime-local"
            defaultValue={window?.startsAt.slice(0, 16)}
            required
          />
        </label>
        <label className="form-field">
          Ends (UTC)
          <input
            name="endsAt"
            type="datetime-local"
            defaultValue={window?.endsAt.slice(0, 16)}
            required
          />
        </label>
      </div>
      <ServiceSelect services={services} selected={window?.serviceIds} />
      <button className="primary-button">
        {window ? "Save maintenance" : "Schedule maintenance"}
      </button>
    </form>
  );
}
export function BackupControls({ backup }: { backup: Backup }) {
  const dr = backup.provider === "dr";
  const target = dr ? "dr-command" : "backup-run";
  const identity = (
    <>
      <input type="hidden" name="profile" value={backup.profile ?? ""} />
      <input type="hidden" name="job" value={backup.job ?? ""} />
    </>
  );
  return (
    <>
      <div className="form-actions">
        <form action={adminAction}>
          <Fields operation={target} id={backup.id} />
          {identity}
          <input type="hidden" name="action" value="run" />
          <button
            disabled={
              backup.status === "running" || backup.status === "pending"
            }
          >
            Run now
          </button>
        </form>
        <span className="health-label">
          Last report: <Time value={backup.reportedAt} />
        </span>
      </div>
      <details className="diagnostic">
        <summary>
          Schedule &amp; availability <span>+</span>
        </summary>
        <form action={adminAction} className="admin-form">
          <Fields
            operation={dr ? "dr-command" : "backup-schedule"}
            id={backup.id}
          />
          {identity}
          <input type="hidden" name="action" value="schedule" />
          <div className="form-grid">
            <label className="form-field">
              {dr
                ? backup.profile === "mac"
                  ? "Interval (seconds)"
                  : "Systemd calendar (include UTC)"
                : "Cron expression (Cloud scheduler timezone)"}
              <input
                name="schedule"
                defaultValue={backup.schedule ?? ""}
                required
                maxLength={160}
                placeholder={dr ? "*-*-* 05:17:00 UTC" : "0 3 * * *"}
              />
            </label>
            <label className="form-field">
              Scheduled runs
              <select name="enabled" defaultValue={String(backup.enabled)}>
                <option value="true">Enabled</option>
                <option value="false">Paused</option>
              </select>
            </label>
          </div>
          <button>Save schedule</button>
        </form>
      </details>
    </>
  );
}
