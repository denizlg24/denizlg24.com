import { describe, expect, it } from "bun:test";
import {
  type ForgeHostSnapshot,
  forgeHostSnapshotSchema,
  metricSeriesNameSchema,
} from "@repo/schemas/cloud";

import { hostMetricSamples, seriesSegment } from "./host-series";

const ts = new Date("2026-08-11T12:00:00.000Z");

function host(overrides: Record<string, unknown> = {}): ForgeHostSnapshot {
  return forgeHostSnapshotSchema.parse({
    cpu: {
      usagePercent: 25,
      cores: 2,
      load1: 1,
      load5: 2,
      load15: 3,
      temperatureCelsius: 47,
    },
    memory: {
      totalBytes: 100,
      usedBytes: 50,
      availableBytes: 50,
      usagePercent: 50,
    },
    ...overrides,
  });
}

function keys(snapshot: ForgeHostSnapshot): string[] {
  return hostMetricSamples(ts, snapshot).map((sample) => sample.key);
}

describe("seriesSegment", () => {
  // Sensor labels are written by board vendors: `Vcore`, `Package id 0`,
  // `CPU Fan`. A key the schema refuses is a sample that never lands.
  it("produces something the series-name schema accepts", () => {
    for (const raw of ["Package id 0", "Vcore", "AUXTIN0", "nvme-pci-0100"]) {
      const name = `forge-host:sensor.${seriesSegment(raw)}.value`;
      expect(metricSeriesNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("never produces an empty segment", () => {
    expect(seriesSegment("///")).toBe("unknown");
    expect(seriesSegment("")).toBe("unknown");
  });

  // The same sensor has to produce the same key on every sample, or its history
  // restarts whenever the reading is rendered differently.
  it("is stable across casing and spacing", () => {
    expect(seriesSegment("CPU Fan")).toBe(seriesSegment("cpu  fan"));
  });
});

describe("hostMetricSamples", () => {
  it("emits every key as a valid series name", () => {
    const samples = hostMetricSamples(
      ts,
      host({
        cpu: {
          usagePercent: 25,
          cores: 2,
          load1: 1,
          load5: 2,
          load15: 3,
          temperatureCelsius: 47,
          perCore: [{ core: 0, usagePercent: 10, mhz: 4200 }],
        },
        sensors: [
          {
            chip: "nct6798",
            key: "fan1",
            label: "CPU Fan",
            kind: "fan",
            value: 1240,
          },
        ],
        disks: [
          {
            device: "nvme0n1",
            readBytesPerSecond: 1,
            writeBytesPerSecond: 2,
            readsPerSecond: 3,
            writesPerSecond: 4,
            utilizationPercent: 5,
            queueLength: 6,
          },
        ],
        filesystems: [
          {
            mount: "/mnt/storage",
            device: "/dev/sda1",
            fstype: "xfs",
            totalBytes: 100,
            usedBytes: 40,
            freeBytes: 60,
            usagePercent: 40,
          },
        ],
        network: [
          {
            name: "eth0",
            rxBytesPerSecond: 1,
            txBytesPerSecond: 2,
            rxPacketsPerSecond: 3,
            txPacketsPerSecond: 4,
            errorsPerSecond: 0,
            dropsPerSecond: 0,
          },
        ],
        pressure: {
          cpu: { some: { avg10: 1, avg60: 2, avg300: 3 } },
        },
      }),
    );

    for (const sample of samples) {
      const name = `${sample.kind}:${sample.key}`;
      expect(metricSeriesNameSchema.safeParse(name).success).toBe(true);
    }
  });

  it("keys a sensor on its sysfs name, not its label", () => {
    const emitted = keys(
      host({
        sensors: [
          {
            chip: "nct6798",
            key: "fan1",
            // A kernel update rewording this must not orphan the history.
            label: "CPU Fan",
            kind: "fan",
            value: 1240,
          },
        ],
      }),
    );
    expect(emitted).toContain("sensor.nct6798.fan1.rpm");
  });

  it("names a filesystem series after its mount, not its device", () => {
    const emitted = keys(
      host({
        filesystems: [
          {
            mount: "/mnt/storage",
            device: "/dev/sda1",
            fstype: "xfs",
            totalBytes: 100,
            usedBytes: 40,
            freeBytes: 60,
            usagePercent: 40,
          },
        ],
      }),
    );
    // A disk replaced behind the same mount keeps its history.
    expect(emitted).toContain("fs.mnt_storage.usage_percent");
  });

  // Storing a value the schema would refuse, or a NaN from a failed read, would
  // fail the whole batch insert and lose every other series in the sample.
  it("drops non-finite readings rather than storing them", () => {
    // Built past the schema on purpose: zod refuses NaN, so a snapshot carrying
    // one can only reach this function if a future field is added without the
    // same guard. That is precisely the case worth being defensive about — the
    // samples go in as one batch insert, and a single bad value fails all of
    // them.
    const broken = host();
    const samples = hostMetricSamples(ts, {
      ...broken,
      cpu: {
        ...broken.cpu,
        usagePercent: Number.NaN,
        temperatureCelsius: null,
      },
    });
    expect(samples.some((sample) => sample.key === "cpu.usage_percent")).toBe(
      false,
    );
    expect(
      samples.some((sample) => sample.key === "cpu.temperature_celsius"),
    ).toBe(false);
    expect(samples.every((sample) => Number.isFinite(sample.value))).toBe(true);
  });

  it("derives uptime from the boot time, and only forwards", () => {
    const samples = hostMetricSamples(
      ts,
      host({
        system: { bootedAt: new Date(ts.getTime() - 7_200_000).toISOString() },
      }),
    );
    expect(
      samples.find((sample) => sample.key === "system.uptime_seconds")?.value,
    ).toBe(7_200);

    // A host clock ahead of ours would otherwise store a negative uptime, which
    // reads as a reboot to any rule watching for one.
    const skewed = keys(
      host({
        system: { bootedAt: new Date(ts.getTime() + 60_000).toISOString() },
      }),
    );
    expect(skewed).not.toContain("system.uptime_seconds");
  });

  it("emits nothing for the sections an older agent omits", () => {
    // The whole reason every new field is optional: the control plane ships
    // ahead of the agent, which waits on a manual approval gate.
    const emitted = keys(host());
    expect(emitted).toContain("cpu.usage_percent");
    expect(emitted.some((key) => key.startsWith("sensor."))).toBe(false);
    expect(emitted.some((key) => key.startsWith("disk."))).toBe(false);
  });
});
