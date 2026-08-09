import { describe, expect, it } from "bun:test";

import {
  HostCollector,
  parseCpuStat,
  parseLoadAverage,
  parseMeminfo,
} from "./host";

describe("deploy host collector", () => {
  it("parses Linux host counters", () => {
    expect(
      parseCpuStat("cpu  60 0 20 20 0 0 0 0\ncpu0 60 0 20 20 0 0 0 0\n"),
    ).toEqual({
      idle: 20,
      total: 100,
      cores: 1,
    });
    expect(parseLoadAverage("0.25 0.50 0.75 1/10 100\n")).toEqual({
      load1: 0.25,
      load5: 0.5,
      load15: 0.75,
    });
    expect(
      parseMeminfo("MemTotal:       1000 kB\nMemAvailable:    250 kB\n"),
    ).toMatchObject({
      totalBytes: 1_024_000,
      usedBytes: 768_000,
      availableBytes: 256_000,
      usagePercent: 75,
    });
  });

  it("derives CPU usage from consecutive samples", async () => {
    const proc = new Map([
      ["meminfo", ["MemTotal:       1000 kB\nMemAvailable:    250 kB\n"]],
      ["loadavg", ["0.25 0.50 0.75 1/10 100\n"]],
      [
        "stat",
        [
          "cpu  60 0 20 20 0 0 0 0\ncpu0 60 0 20 20 0 0 0 0\n",
          "cpu  120 0 40 40 0 0 0 0\ncpu0 120 0 40 40 0 0 0 0\n",
        ],
      ],
    ]);
    const collector = new HostCollector({
      readProc: async (path) => {
        const values = proc.get(path);
        const value = values?.length === 1 ? values[0] : values?.shift();
        if (!value) throw new Error(`missing ${path}`);
        return value;
      },
      readTemperature: async () => 42,
    });

    await collector.collect();
    const second = await collector.collect();
    expect(second.cpu).toMatchObject({
      usagePercent: 80,
      cores: 1,
      load1: 0.25,
      temperatureCelsius: 42,
    });
  });
});
