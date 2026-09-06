import Link from "next/link";
import { groups } from "@/lib/catalog";
import type { PublicData } from "@/lib/data";
import { availability, dailyHealth, healthLabels } from "@/lib/health";
import type { Health } from "@/lib/model";
import { Time } from "./time";
export function Dot({ status }: { status: Health }) {
  return <span aria-hidden="true" className={`status-dot ${status}`} />;
}
const headlines: Record<Health, string> = {
  operational: "All services are online",
  down: "Service outage",
  degraded: "Degraded performance",
  unknown: "No recent data",
  maintenance: "Under maintenance",
};

export function Overview({ data }: { data: PublicData }) {
  return (
    <section className="overview" aria-labelledby="overview-title">
      <h1 id="overview-title">
        <Dot status={data.status} />
        <span className="fresh-heading">{headlines[data.status]}</span>
        <span className="stale-heading">No recent data</span>
      </h1>
    </section>
  );
}
export function ServiceList({ data }: { data: PublicData }) {
  const today = Date.parse(`${data.generatedAt.slice(0, 10)}T00:00:00Z`);
  const days = Array.from({ length: 90 }, (_, index) =>
    new Date(today - (89 - index) * 86400_000).toISOString().slice(0, 10),
  );
  const byService = new Map(
    data.services.map((service) => [
      service.id,
      data.daily.filter((day) => day.serviceId === service.id),
    ]),
  );
  return (
    <section className="service-panel">
      <div className="section-heading">
        <h2>Current status by service</h2>
        <span className={`status-pill ${data.status}`}>
          <Dot status={data.status} />
          {healthLabels[data.status]}
        </span>
      </div>
      {groups.map((group) => {
        const services = data.services.filter(
          (service) => service.group === group,
        );
        if (!services.length) return null;
        return (
          <section className="service-group" key={group}>
            <h3>{group}</h3>
            {services.map((service) => {
              const history = byService.get(service.id) ?? [];
              const indexed = new Map(history.map((day) => [day.day, day]));
              const measured = availability(history);
              return (
                <article
                  className="service-row"
                  key={service.id}
                  id={service.id}
                >
                  <div className="service-heading">
                    <h4>
                      <Dot status={service.status} />
                      {service.name}
                      <span
                        className="service-info"
                        role="img"
                        title={service.description}
                        aria-label={service.description}
                      >
                        i
                      </span>
                      {service.status === "operational" ? null : (
                        <span className={`health-label ${service.status}`}>
                          {healthLabels[service.status]}
                        </span>
                      )}
                    </h4>
                    <span
                      className={`uptime ${service.status}`}
                      title={`${measured.measured.toLocaleString()} measured minutes`}
                    >
                      {measured.percent === null
                        ? "—"
                        : `${measured.percent.toFixed(3)}% uptime`}
                    </span>
                  </div>
                  <div
                    className="uptime-bars"
                    role="img"
                    aria-label={`${service.name}: daily health for the past 90 days`}
                  >
                    {days.map((day) => {
                      const count = indexed.get(day);
                      const state = dailyHealth(count);
                      const known = count
                        ? count.operational + count.degraded + count.down
                        : 0;
                      return (
                        <span
                          key={day}
                          className={`uptime-bar ${state}`}
                          title={`${day} UTC · ${healthLabels[state]} · ${known} measured minutes${known < 1440 ? " · partial coverage" : ""}`}
                        />
                      );
                    })}
                  </div>
                  <div className="history-axis">
                    <span>90 days ago</span>
                    <span>Today</span>
                  </div>
                </article>
              );
            })}
          </section>
        );
      })}
    </section>
  );
}
export function ActiveIncidents({ data }: { data: PublicData }) {
  const active = data.incidents.filter((incident) => !incident.resolvedAt);
  if (!active.length) return null;
  return (
    <aside className="notice-list" aria-label="Active incidents">
      {active.map((incident) => (
        <Link
          prefetch={false}
          className="notice"
          key={incident.id}
          href={`/incidents#${incident.id}`}
        >
          <Dot status="down" />
          <div>
            <strong>{incident.title}</strong>
            <p>{incident.explanation}</p>
            <small>
              Since <Time value={incident.startedAt} />
            </small>
          </div>
          <span aria-hidden="true">↗</span>
        </Link>
      ))}
    </aside>
  );
}
