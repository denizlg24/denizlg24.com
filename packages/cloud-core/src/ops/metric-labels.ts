import type { AlertRuleUnit } from "@repo/schemas/cloud";

export interface MetricDescription {
  label: string;
  group: string;
  unit: AlertRuleUnit;
}

export interface DescribeMetricOptions {
  /** Docker container id (full or short) to container name. */
  containerNames?: ReadonlyMap<string, string>;
}

/**
 * Suffix-driven, so a collector that follows the naming convention gets the
 * right unit without being registered anywhere.
 */
export function inferMetricUnit(series: string): AlertRuleUnit {
  if (series.endsWith("_percent")) return "percent";
  if (series.endsWith("_bytes_per_second")) return "bytes_per_second";
  if (series.endsWith("_bytes")) return "bytes";
  if (series.endsWith("_celsius")) return "celsius";
  if (series.endsWith(".per_core")) return "ratio";
  return "count";
}

/**
 * The forge host publishes families whose members are not knowable in advance —
 * one series per sensor the board exposes, per core, per disk, per interface.
 * Naming them is therefore a pattern match on the key rather than a table.
 */
const FORGE_HOST_PATTERNS: {
  pattern: RegExp;
  label: (match: RegExpExecArray) => string;
  group: string;
}[] = [
  {
    pattern: /^cpu\.core\.(\d+)\.usage_percent$/,
    label: (match) => `core ${match[1]} usage`,
    group: "cpu cores",
  },
  {
    pattern: /^cpu\.core\.(\d+)\.mhz$/,
    label: (match) => `core ${match[1]} clock`,
    group: "cpu cores",
  },
  {
    pattern: /^sensor\.([^.]+)\.([^.]+)\.([^.]+)$/,
    label: (match) => `${match[1]} ${match[2]} (${match[3]})`,
    group: "sensors",
  },
  {
    pattern: /^power\.([^.]+)\.watts$/,
    label: (match) => `${match[1]} power`,
    group: "power",
  },
  {
    pattern: /^disk\.([^.]+)\.(.+)$/,
    label: (match) => `${match[1]} ${match[2]?.replace(/_/g, " ")}`,
    group: "disks",
  },
  {
    pattern: /^fs\.(.+?)\.([a-z_]+)$/,
    label: (match) =>
      `${match[1]?.replace(/_/g, "/")} ${match[2]?.replace(/_/g, " ")}`,
    group: "filesystems",
  },
  {
    pattern: /^net\.([^.]+)\.(.+)$/,
    label: (match) => `${match[1]} ${match[2]?.replace(/_/g, " ")}`,
    group: "network",
  },
  {
    pattern: /^pressure\.([^.]+)\.([^.]+)\.avg10$/,
    label: (match) => `${match[1]} pressure (${match[2]})`,
    group: "pressure",
  },
];

/** Keys under `forge-host:` that are one of a kind. */
const FORGE_HOST_LABELS: Record<string, string> = {
  "agent.up": "agent reachable",
  "agent.latency_ms": "agent response time",
  "cpu.usage_percent": "cpu usage",
  "cpu.temperature_celsius": "cpu temperature",
  "cpu.context_switches_per_second": "context switches",
  "cpu.interrupts_per_second": "interrupts",
  "cpu.forks_per_second": "forks",
  "cpu.procs_running": "processes running",
  "cpu.procs_blocked": "processes blocked",
  "load.1": "load (1m)",
  "load.5": "load (5m)",
  "load.15": "load (15m)",
  "memory.usage_percent": "memory usage",
  "memory.used_bytes": "memory used",
  "memory.available_bytes": "memory available",
  "memory.free_bytes": "memory free",
  "memory.cached_bytes": "page cache",
  "memory.buffers_bytes": "buffers",
  "memory.dirty_bytes": "dirty pages",
  "memory.slab_bytes": "kernel slab",
  "memory.swap_used_bytes": "swap used",
  "memory.swap_usage_percent": "swap usage",
  "disk.usage_percent": "runtime disk usage",
  "build_disk.usage_percent": "build disk usage",
  "system.processes": "processes",
  "system.threads": "threads",
  "system.uptime_seconds": "host uptime",
};

function describeForgeHost(key: string): MetricDescription {
  const unit = inferMetricUnit(key);
  const known = FORGE_HOST_LABELS[key];
  if (known) return { label: known, group: "host", unit };
  for (const entry of FORGE_HOST_PATTERNS) {
    const match = entry.pattern.exec(key);
    if (match) return { label: entry.label(match), group: entry.group, unit };
  }
  return { label: key.replace(/[._]/g, " "), group: "host", unit };
}

/** Keys under `host:` whose plain-English name is not derivable from the key. */
const HOST_LABELS: Record<string, string> = {
  "cpu.usage_percent": "cpu usage",
  "cpu.temperature_celsius": "cpu temperature",
  "load.1": "load (1m)",
  "load.5": "load (5m)",
  "load.15": "load (15m)",
  "load.per_core": "load per core",
  "memory.usage_percent": "memory usage",
  "swap.usage_percent": "swap usage",
  "swap.used_bytes": "swap used",
  "swap.in_bytes_per_second": "swap paged in",
  "swap.out_bytes_per_second": "swap paged out",
  "fd.allocated": "file descriptors open",
  "fd.usage_percent": "file descriptors used",
  "fd.process_open": "api process descriptors",
  "fd.process_usage_percent": "api process descriptors used",
  "connections.established": "connections established",
  "connections.inbound": "connections inbound",
  "connections.outbound": "connections outbound",
  "connections.listening": "listening sockets",
  "connections.time_wait": "connections in time-wait",
  "connections.orphan": "orphaned sockets",
};

const DATABASE_LABELS: Record<string, string> = {
  "postgres.connections": "postgres connections",
  "postgres.connections_percent": "postgres connections used",
  "postgres.active": "postgres active queries",
  "postgres.idle_in_transaction": "postgres idle in transaction",
  "postgres.waiting": "postgres waiting on locks",
  "mongodb.connections_current": "mongodb connections",
  "mongodb.connections_available": "mongodb connections available",
  "mongodb.connections_percent": "mongodb connections used",
  "mongodb.queued_total": "mongodb queued operations",
  "redis.connected_clients": "redis clients",
  "redis.used_memory_bytes": "redis memory used",
};

const STORAGE_LABELS: Record<string, string> = {
  total_bytes: "storage size",
  file_count: "file count",
  folder_count: "folder count",
};

const CONTAINER_METRIC_LABELS: Record<string, string> = {
  cpu_percent: "cpu",
  memory_percent: "memory",
  network_rx_bytes: "network rx",
  network_tx_bytes: "network tx",
};

const DISK_METRIC_LABELS: Record<string, string> = {
  usage_percent: "usage",
  read_bytes_per_second: "read",
  write_bytes_per_second: "write",
  io_utilization_percent: "busy",
};

const NETWORK_METRIC_LABELS: Record<string, string> = {
  rx_bytes_per_second: "rx",
  tx_bytes_per_second: "tx",
};

function splitTail(key: string): { head: string; tail: string } {
  const separator = key.lastIndexOf(".");
  if (separator < 0) return { head: key, tail: "" };
  return { head: key.slice(0, separator), tail: key.slice(separator + 1) };
}

/** `/dev/nvme0n1p1` -> `nvme0n1p1`; the prefix is noise in a picker. */
function shortDevice(device: string): string {
  return device.replace(/^\/dev\//, "");
}

/**
 * Container ids are recorded in full but may be displayed short, so a lookup
 * falls back to prefix matching before giving up and showing a truncated id.
 */
function containerLabel(
  id: string,
  containerNames: ReadonlyMap<string, string> | undefined,
): string {
  const exact = containerNames?.get(id);
  if (exact) return exact;
  if (containerNames) {
    for (const [candidate, name] of containerNames) {
      if (candidate.startsWith(id) || id.startsWith(candidate)) return name;
    }
  }
  return `${id.slice(0, 12)}…`;
}

/**
 * Turns a raw series name into something a person can pick out of a list. The
 * fallback keeps unknown series usable rather than hiding them: a collector
 * added later still shows up, just with a less polished label.
 */
export function describeMetricSeries(
  series: string,
  options: DescribeMetricOptions = {},
): MetricDescription {
  const unit = inferMetricUnit(series);
  const separator = series.indexOf(":");
  if (separator < 1) return { label: series, group: "other", unit };

  const kind = series.slice(0, separator);
  const key = series.slice(separator + 1);

  switch (kind) {
    case "host":
      return {
        label: HOST_LABELS[key] ?? key.replace(/[._]/g, " "),
        group: "host",
        unit,
      };

    // The Pi's `host:` and the forge box's `forge-host:` are separate machines
    // reporting separate series, and the forge one publishes families whose
    // members depend on what hardware is in the box.
    case "forge-host":
      return describeForgeHost(key);

    case "db":
      return {
        label: DATABASE_LABELS[key] ?? key.replace(/[._]/g, " "),
        group: "databases",
        unit,
      };

    case "storage":
      return {
        label: STORAGE_LABELS[key] ?? key.replace(/[._]/g, " "),
        group: "storage",
        unit,
      };

    case "disk": {
      const { head, tail } = splitTail(key);
      return {
        label: `${shortDevice(head)} ${DISK_METRIC_LABELS[tail] ?? tail.replace(/_/g, " ")}`,
        group: "disks",
        unit,
      };
    }

    case "network": {
      const { head, tail } = splitTail(key);
      return {
        label: `${head} ${NETWORK_METRIC_LABELS[tail] ?? tail.replace(/_/g, " ")}`,
        group: "network",
        unit,
      };
    }

    case "container": {
      const { head, tail } = splitTail(key);
      const name = containerLabel(head, options.containerNames);
      return {
        label: `${name} ${CONTAINER_METRIC_LABELS[tail] ?? tail.replace(/_/g, " ")}`,
        group: "containers",
        unit,
      };
    }

    default:
      return { label: key.replace(/[._]/g, " "), group: kind, unit };
  }
}

/** Host first, then the things most likely to be alerted on. */
const GROUP_ORDER = [
  "host",
  "cpu cores",
  "sensors",
  "power",
  "pressure",
  "databases",
  "disks",
  "filesystems",
  "network",
  "containers",
  "storage",
];

export function compareMetricGroups(a: string, b: string): number {
  const left = GROUP_ORDER.indexOf(a);
  const right = GROUP_ORDER.indexOf(b);
  if (left === right) return a.localeCompare(b);
  if (left < 0) return 1;
  if (right < 0) return -1;
  return left - right;
}
