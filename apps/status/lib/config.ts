import { appOrigins, catalog, groups } from "./catalog";
import type { Service } from "./model";

export type SourceKind = "monitor" | "heartbeat";
/** A Better Stack monitor or heartbeat as last seen upstream. */
export type DiscoveredSource = {
  _id: string;
  kind: SourceKind;
  externalId: string;
  name: string;
  url: string | null;
  monitorType: string | null;
  upstreamStatus: string | null;
  lastCheckedAt: string | null;
  lastSeenAt: string;
  missingSince: string | null;
};
export type SourceBinding =
  | { kind: "ignore" }
  | { kind: "service"; serviceId: string }
  | { kind: "own"; name: string; group: string; description: string };
export type ServiceOverride = {
  visible?: boolean;
  name?: string;
  description?: string;
  group?: string;
  order?: number;
};
export type StatusConfig = {
  _id: "config";
  services: Record<string, ServiceOverride>;
  bindings: Record<string, SourceBinding>;
  groups: string[];
  updatedAt: string | null;
  updatedBy: string | null;
};

export const emptyConfig: StatusConfig = {
  _id: "config",
  services: {},
  bindings: {},
  groups: [],
  updatedAt: null,
  updatedBy: null,
};
export const sourceKey = (kind: SourceKind, externalId: string) =>
  `${kind}:${externalId}`;
const catalogOrder = new Map(
  catalog.map((service, index) => [service.id, index]),
);

export function monitorEnvMap(): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(process.env.STATUS_MONITOR_MAP ?? "{}");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}
/**
 * What a source feeds when nobody has said otherwise. A monitor whose URL is one
 * of ours joins that service; everything else is ignored, so a monitor added in
 * Better Stack never reaches the public page until it is chosen in the admin.
 */
export function defaultBinding(
  source: Pick<DiscoveredSource, "kind" | "externalId" | "url">,
  envMap: Record<string, string> = monitorEnvMap(),
): SourceBinding {
  const mapped = envMap[source.externalId];
  if (mapped) return { kind: "service", serviceId: mapped };
  if (source.kind === "monitor" && source.url) {
    try {
      const url = new URL(source.url);
      if (url.hostname === "api.denizlg24.com")
        return {
          kind: "service",
          serviceId: url.pathname === "/healthz/deep" ? "deep-health" : "api",
        };
      const app = Object.entries(appOrigins).find(
        ([, origin]) => origin === url.origin,
      );
      if (app) return { kind: "service", serviceId: app[0] };
    } catch {
      /* A non-HTTP monitor has no origin to match. */
    }
  }
  return { kind: "ignore" };
}
export function resolveBinding(
  config: StatusConfig,
  source: Pick<DiscoveredSource, "_id" | "kind" | "externalId" | "url">,
  envMap: Record<string, string> = monitorEnvMap(),
): SourceBinding {
  return config.bindings[source._id] ?? defaultBinding(source, envMap);
}
/** The service id a source's evidence is attributed to, or null when ignored. */
export function bindingTarget(
  binding: SourceBinding,
  sourceId: string,
): string | null {
  if (binding.kind === "ignore") return null;
  return binding.kind === "service" ? binding.serviceId : sourceId;
}
export function orderedGroups(config: StatusConfig): string[] {
  const configured = config.groups.filter((group) => group.trim().length > 0);
  return Array.from(new Set([...configured, ...groups]));
}
export function serviceVisible(config: StatusConfig, id: string): boolean {
  return config.services[id]?.visible !== false;
}
/**
 * Applies the admin's overrides to what the collector observed, drops anything
 * hidden, and orders the result. The public page and the admin share this so the
 * overall banner is computed from exactly the tiles that are shown.
 */
export function resolveServices(
  observed: Service[],
  config: StatusConfig,
): Service[] {
  const groupOrder = new Map(
    orderedGroups(config).map((group, index) => [group, index]),
  );
  return observed
    .filter((service) => serviceVisible(config, service.id))
    .map((service) => {
      const override = config.services[service.id];
      return {
        ...service,
        name: override?.name?.trim() || service.name,
        description: override?.description?.trim() || service.description,
        group: override?.group?.trim() || service.group,
      };
    })
    .sort((a, b) => {
      const groupDelta =
        (groupOrder.get(a.group) ?? Number.MAX_SAFE_INTEGER) -
        (groupOrder.get(b.group) ?? Number.MAX_SAFE_INTEGER);
      if (groupDelta !== 0) return groupDelta;
      const rank = (service: Service) =>
        config.services[service.id]?.order ??
        catalogOrder.get(service.id) ??
        Number.MAX_SAFE_INTEGER;
      return rank(a) - rank(b) || a.name.localeCompare(b.name);
    });
}
