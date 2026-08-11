import { describe, expect, it } from "bun:test";

import { readEnergyCounters, readSensors } from "./sensors";
import {
  parseCpuModel,
  parseOsRelease,
  parseProcessStat,
  topProcesses,
} from "./system";

/** A fake `/sys` tree: directory listings and file contents, nothing else. */
function fakeSysfs(tree: Record<string, Record<string, string>>) {
  return {
    readDir: async (path: string) => {
      const direct = tree[path];
      if (direct) return Object.keys(direct);
      const children = Object.keys(tree)
        .filter((key) => key.startsWith(`${path}/`))
        .map((key) => key.slice(path.length + 1).split("/")[0]);
      if (children.length === 0) throw new Error(`no such directory: ${path}`);
      return [...new Set(children)] as string[];
    },
    readValue: async (path: string) => {
      const separator = path.lastIndexOf("/");
      const dir = path.slice(0, separator);
      const file = path.slice(separator + 1);
      const value = tree[dir]?.[file];
      if (value === undefined) throw new Error(`no such file: ${path}`);
      return value;
    },
  };
}

describe("readSensors", () => {
  it("converts each hwmon unit and keeps the chip that published it", async () => {
    const sensors = await readSensors({
      root: "/hwmon",
      ...fakeSysfs({
        "/hwmon/hwmon0": {
          name: "coretemp",
          temp1_input: "47000",
          temp1_label: "Package id 0",
          temp1_crit: "100000",
        },
        "/hwmon/hwmon1": {
          name: "nct6798",
          fan1_input: "1240",
          fan1_label: "CPU Fan",
          in0_input: "1104",
          power1_input: "65000000",
        },
      }),
    });

    expect(sensors).toEqual([
      {
        chip: "coretemp",
        key: "temp1",
        label: "Package id 0",
        kind: "temperature",
        value: 47,
        critical: 100,
        max: null,
      },
      {
        chip: "nct6798",
        key: "fan1",
        label: "CPU Fan",
        kind: "fan",
        value: 1_240,
        critical: null,
        max: null,
      },
      {
        chip: "nct6798",
        key: "in0",
        label: "in0",
        kind: "voltage",
        value: 1.104,
        critical: null,
        max: null,
      },
      {
        chip: "nct6798",
        key: "power1",
        label: "power1",
        kind: "power",
        value: 65,
        critical: null,
        max: null,
      },
    ]);
  });

  // A tower has several unpopulated fan headers and every one of them reads 0
  // forever. They are not fans running at zero rpm.
  it("drops a fan header reading zero", async () => {
    const sensors = await readSensors({
      root: "/hwmon",
      ...fakeSysfs({
        "/hwmon/hwmon0": {
          name: "nct6798",
          fan3_input: "0",
          fan1_input: "900",
        },
      }),
    });
    expect(sensors.map((sensor) => sensor.key)).toEqual(["fan1"]);
  });

  // One unreadable file on one chip must not cost the readings of every other.
  it("skips an unreadable sensor without losing its neighbours", async () => {
    const tree = fakeSysfs({
      "/hwmon/hwmon0": {
        name: "coretemp",
        temp1_input: "40000",
        // Present on the chip, and unreadable. Without it the test proves only
        // that one readable sensor is returned.
        temp2_input: "50000",
      },
    });
    const sensors = await readSensors({
      root: "/hwmon",
      readDir: tree.readDir,
      readValue: async (path) =>
        path.endsWith("temp2_input")
          ? Promise.reject(new Error("EIO"))
          : tree.readValue(path),
    });
    expect(sensors.map((sensor) => sensor.key)).toEqual(["temp1"]);
  });

  // Nothing loaded is a valid state, not a failure — it means the board's
  // module is not installed, which is a host config step.
  it("reports nothing when no hwmon chips exist", async () => {
    expect(await readSensors({ root: "/nowhere" })).toEqual([]);
  });
});

describe("readEnergyCounters", () => {
  it("returns the raw counter, not a power reading", async () => {
    const counters = await readEnergyCounters({
      root: "/powercap",
      ...fakeSysfs({
        "/powercap/intel-rapl:0": { name: "package-0", energy_uj: "123456789" },
        // Not a RAPL zone; the driver publishes constraints beside them.
        "/powercap/other": { name: "nope", energy_uj: "1" },
      }),
    });
    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({
      zone: "package-0",
      microjoules: 123_456_789,
    });
  });
});

describe("parseProcessStat", () => {
  // `comm` is parenthesised and may itself contain spaces and parentheses.
  // Splitting the line on whitespace is the classic way to misparse this.
  it("survives a command name containing spaces and brackets", () => {
    const fields = Array.from({ length: 20 }, (_, index) => String(index)).join(
      " ",
    );
    const parsed = parseProcessStat(`42 (my (weird) app) S ${fields}`);
    expect(parsed?.pid).toBe(42);
    expect(parsed?.command).toBe("my (weird) app");
    expect(parsed?.state).toBe("S");
  });

  it("returns null for a line it cannot use", () => {
    expect(parseProcessStat("nonsense")).toBeNull();
  });
});

describe("topProcesses", () => {
  const counters = [
    {
      pid: 1,
      command: "busy",
      state: "R",
      jiffies: 1_100,
      threads: 4,
      residentBytes: 1_000,
    },
    {
      pid: 2,
      command: "fat",
      state: "S",
      jiffies: 10,
      threads: 1,
      residentBytes: 9_000_000,
    },
  ];

  it("reports CPU over the interval, not since boot", () => {
    const [top] = topProcesses(counters, new Map([[1, 1_000]]), 1, 5);
    // 100 jiffies at 100 Hz over one second is one full core.
    expect(top?.cpuPercent).toBe(100);
  });

  // A process that just started has no previous sample. Charging it its whole
  // lifetime's usage in one interval puts every new process at the top.
  it("reports a process with no previous sample as idle", () => {
    const ranked = topProcesses(counters, new Map(), 1, 5);
    expect(ranked.every((process) => process.cpuPercent === 0)).toBe(true);
  });

  // "What is burning the box" and "what is holding it" rarely have the same
  // answer, and a list answering only the first is the one that misses a leak.
  it("includes the memory leaders even when they use no cpu", () => {
    const ranked = topProcesses(counters, new Map([[1, 1_000]]), 1, 1);
    expect(ranked.map((process) => process.pid)).toEqual([1, 2]);
  });
});

describe("system identity parsing", () => {
  it("reads the pretty name out of os-release", () => {
    expect(
      parseOsRelease(
        'NAME="Ubuntu"\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\nID=ubuntu',
      ),
    ).toBe("Ubuntu 24.04.1 LTS");
  });

  it("takes the first model name from cpuinfo, which every core repeats", () => {
    expect(
      parseCpuModel(
        "processor\t: 0\nmodel name\t: AMD Ryzen 9 7950X\nprocessor\t: 1\nmodel name\t: AMD Ryzen 9 7950X\n",
      ),
    ).toBe("AMD Ryzen 9 7950X");
  });

  it("returns null rather than guessing when the field is absent", () => {
    expect(parseOsRelease("ID=alpine")).toBeNull();
    expect(parseCpuModel("processor\t: 0\n")).toBeNull();
  });
});
