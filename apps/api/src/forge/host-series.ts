import type { MetricSampleInput } from "@repo/cloud-core";
import type { ForgeHostSnapshot } from "@repo/schemas/cloud";

/**
 * `metricSeriesNameSchema` accepts `[a-zA-Z0-9_./:-]` after the prefix, and a
 * sensor label is written by a board vendor — `Vcore`, `AUXTIN0`, `CPU Fan`,
 * `Package id 0`. Anything outside the charset collapses to `_` so the key is
 * both storable and stable: the same sensor has to produce the same series name
 * on every sample, or its history restarts whenever the label is rendered
 * differently.
 */
export function seriesSegment(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown"
  );
}

/** Sensor readings carry their unit in the key, since the kind is not in it. */
const SENSOR_UNITS: Record<string, string> = {
  temperature: "celsius",
  fan: "rpm",
  voltage: "volts",
  power: "watts",
  current: "amps",
  pwm: "duty",
  energy: "joules",
};

/**
 * Every numeric leaf of a host snapshot, as `forge-host` samples.
 *
 * The set is derived from the snapshot rather than declared, because what the
 * host publishes is not knowable ahead of time: a board exposes whichever
 * sensors its kernel module found, a machine has whichever disks are plugged
 * in. The catalog endpoint reads the series that exist back out of the table,
 * so the two never have to agree on a list.
 *
 * Everything stored is either a level (a percentage, a temperature, an RPM) or
 * a rate. Never a counter — `rollupAndPruneMetrics` averages 30s rows into 300s
 * buckets, and the average of a monotonic counter is a number that describes
 * nothing.
 */
export function hostMetricSamples(
  ts: Date,
  host: ForgeHostSnapshot,
): MetricSampleInput[] {
  const samples: MetricSampleInput[] = [];
  const push = (key: string, value: number | null | undefined) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    samples.push({ ts, kind: "forge-host", key, value });
  };

  const { cpu, memory } = host;
  push("cpu.usage_percent", cpu.usagePercent);
  push("load.1", cpu.load1);
  push("load.5", cpu.load5);
  push("load.15", cpu.load15);
  push("cpu.temperature_celsius", cpu.temperatureCelsius);
  push("cpu.context_switches_per_second", cpu.contextSwitchesPerSecond);
  push("cpu.interrupts_per_second", cpu.interruptsPerSecond);
  push("cpu.forks_per_second", cpu.forksPerSecond);
  push("cpu.procs_running", cpu.running);
  push("cpu.procs_blocked", cpu.blocked);

  for (const core of cpu.perCore) {
    push(`cpu.core.${core.core}.usage_percent`, core.usagePercent);
    push(`cpu.core.${core.core}.mhz`, core.mhz);
  }

  push("memory.usage_percent", memory.usagePercent);
  push("memory.used_bytes", memory.usedBytes);
  push("memory.available_bytes", memory.availableBytes);
  push("memory.free_bytes", memory.freeBytes);
  push("memory.cached_bytes", memory.cachedBytes);
  push("memory.buffers_bytes", memory.buffersBytes);
  push("memory.dirty_bytes", memory.dirtyBytes);
  push("memory.slab_bytes", memory.slabBytes);
  push("memory.swap_used_bytes", memory.swapUsedBytes);
  push("memory.swap_usage_percent", memory.swapUsagePercent);

  for (const sensor of host.sensors) {
    // Keyed on the sysfs name, not the label. A kernel update that rewords
    // "Package id 0" would otherwise orphan the history and start a new series
    // beside it.
    const key = `sensor.${seriesSegment(sensor.chip)}.${seriesSegment(sensor.key)}`;
    push(`${key}.${SENSOR_UNITS[sensor.kind] ?? "value"}`, sensor.value);
  }

  for (const zone of host.power) {
    push(`power.${seriesSegment(zone.zone)}.watts`, zone.watts);
  }

  for (const disk of host.disks) {
    const key = `disk.${seriesSegment(disk.device)}`;
    push(`${key}.read_bytes_per_second`, disk.readBytesPerSecond);
    push(`${key}.write_bytes_per_second`, disk.writeBytesPerSecond);
    push(`${key}.reads_per_second`, disk.readsPerSecond);
    push(`${key}.writes_per_second`, disk.writesPerSecond);
    push(`${key}.utilization_percent`, disk.utilizationPercent);
    push(`${key}.queue_length`, disk.queueLength);
  }

  for (const filesystem of host.filesystems) {
    // The mount point, not the device: `/mnt/storage` is what a person reads,
    // and a disk replaced behind the same mount keeps its history.
    const key = `fs.${seriesSegment(filesystem.mount)}`;
    push(`${key}.usage_percent`, filesystem.usagePercent);
    push(`${key}.used_bytes`, filesystem.usedBytes);
    push(`${key}.free_bytes`, filesystem.freeBytes);
  }

  for (const nic of host.network) {
    const key = `net.${seriesSegment(nic.name)}`;
    push(`${key}.rx_bytes_per_second`, nic.rxBytesPerSecond);
    push(`${key}.tx_bytes_per_second`, nic.txBytesPerSecond);
    push(`${key}.rx_packets_per_second`, nic.rxPacketsPerSecond);
    push(`${key}.tx_packets_per_second`, nic.txPacketsPerSecond);
    push(`${key}.errors_per_second`, nic.errorsPerSecond);
    push(`${key}.drops_per_second`, nic.dropsPerSecond);
  }

  if (host.pressure) {
    for (const [resource, reading] of Object.entries(host.pressure)) {
      if (!reading) continue;
      // avg10 only. The kernel's own 60s and 300s averages are derivable from a
      // history of the 10s one, and storing all three triples the row count of
      // this family for information already in the table.
      push(`pressure.${resource}.some.avg10`, reading.some.avg10);
      push(`pressure.${resource}.full.avg10`, reading.full?.avg10);
    }
  }

  if (host.system) {
    push("system.processes", host.system.processes);
    push("system.threads", host.system.threads);
    // Derived from the boot time rather than reported, because "how long has it
    // been up" is the alertable form of it: a value that drops back to near
    // zero is a reboot, and a reboot nobody asked for is the thing worth
    // knowing. The boot time itself is a constant between restarts and would
    // store one identical row every 30 seconds forever.
    if (host.system.bootedAt) {
      const seconds =
        (ts.getTime() - new Date(host.system.bootedAt).getTime()) / 1_000;
      if (seconds >= 0) push("system.uptime_seconds", seconds);
    }
  }

  return samples;
}
