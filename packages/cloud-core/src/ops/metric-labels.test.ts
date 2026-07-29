import { describe, expect, it } from "bun:test";

import {
  compareMetricGroups,
  describeMetricSeries,
  inferMetricUnit,
} from "./metric-labels";

const CONTAINERS = new Map([
  ["3f8a9b2c1d4e5f60718293a4b5c6d7e8f9012345678abcdef0123456789abcde", "api"],
  ["aa11bb22cc33dd44ee55ff6677889900aabbccddeeff00112233445566778899", "mongo"],
]);

describe("inferMetricUnit", () => {
  it("reads the unit off the key suffix", () => {
    expect(inferMetricUnit("host:swap.usage_percent")).toBe("percent");
    expect(inferMetricUnit("host:swap.out_bytes_per_second")).toBe(
      "bytes_per_second",
    );
    expect(inferMetricUnit("db:redis.used_memory_bytes")).toBe("bytes");
    expect(inferMetricUnit("host:cpu.temperature_celsius")).toBe("celsius");
    expect(inferMetricUnit("host:load.per_core")).toBe("ratio");
    expect(inferMetricUnit("host:connections.inbound")).toBe("count");
  });

  it("prefers the more specific byte-rate suffix over plain bytes", () => {
    expect(inferMetricUnit("network:eth0.rx_bytes_per_second")).not.toBe(
      "bytes",
    );
  });
});

describe("describeMetricSeries", () => {
  it("resolves a container id to its name", () => {
    const described = describeMetricSeries(
      "container:3f8a9b2c1d4e5f60718293a4b5c6d7e8f9012345678abcdef0123456789abcde.cpu_percent",
      { containerNames: CONTAINERS },
    );
    expect(described).toEqual({
      label: "api cpu",
      group: "containers",
      unit: "percent",
    });
  });

  it("matches a short id against the full one", () => {
    // Docker reports ids at either length depending on the call.
    expect(
      describeMetricSeries("container:aa11bb22cc33.memory_percent", {
        containerNames: CONTAINERS,
      }).label,
    ).toBe("mongo memory");
  });

  it("truncates an unknown id rather than printing a 64-character sha", () => {
    const label = describeMetricSeries(
      "container:0000111122223333444455556666777788889999aaaabbbbccccddddeeeeffff.cpu_percent",
      { containerNames: CONTAINERS },
    ).label;
    expect(label).toBe("000011112222… cpu");
    expect(label.length).toBeLessThan(24);
  });

  it("falls back gracefully when no container names are available", () => {
    expect(
      describeMetricSeries("container:abcdef123456789.cpu_percent").label,
    ).toBe("abcdef123456… cpu");
  });

  it("names host, database and storage series from their tables", () => {
    expect(describeMetricSeries("host:fd.process_usage_percent")).toEqual({
      label: "api process descriptors used",
      group: "host",
      unit: "percent",
    });
    expect(describeMetricSeries("db:mongodb.connections_percent").label).toBe(
      "mongodb connections used",
    );
    expect(describeMetricSeries("storage:total_bytes").group).toBe("storage");
  });

  it("strips the /dev prefix from disk series", () => {
    expect(describeMetricSeries("disk:/dev/nvme0n1p1.usage_percent")).toEqual({
      label: "nvme0n1p1 usage",
      group: "disks",
      unit: "percent",
    });
  });

  it("labels network interfaces by direction", () => {
    expect(describeMetricSeries("network:eth0.tx_bytes_per_second").label).toBe(
      "eth0 tx",
    );
  });

  it("keeps an unknown series usable instead of hiding it", () => {
    // A collector added later must still be pickable, just less polished.
    const described = describeMetricSeries("host:future.new_thing");
    expect(described.label).toBe("future new thing");
    expect(described.group).toBe("host");

    const unknownKind = describeMetricSeries("weather:outside.temp_celsius");
    expect(unknownKind.group).toBe("weather");
    expect(unknownKind.unit).toBe("celsius");
  });
});

describe("compareMetricGroups", () => {
  it("puts host first and unknown groups last", () => {
    const groups = ["containers", "weather", "host", "databases", "disks"];
    expect([...groups].sort(compareMetricGroups)).toEqual([
      "host",
      "databases",
      "disks",
      "containers",
      "weather",
    ]);
  });
});
