import { describe, expect, it } from "bun:test";

import {
  NoFreePortError,
  PORT_RANGE_END,
  PORT_RANGE_START,
  PortAllocator,
} from "./ports";

function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length] ?? 0;
}

describe("PortAllocator", () => {
  it("allocates inside the range", async () => {
    const allocator = new PortAllocator({ probe: async () => false });
    const port = await allocator.allocate("a");
    expect(port).toBeGreaterThanOrEqual(PORT_RANGE_START);
    expect(port).toBeLessThanOrEqual(PORT_RANGE_END);
  });

  it("never hands the same port to two deployments", async () => {
    const allocator = new PortAllocator({
      probe: async () => false,
      random: sequence([0, 0, 0.5]),
    });
    const first = await allocator.allocate("a");
    const second = await allocator.allocate("b");
    expect(second).not.toBe(first);
  });

  it("skips a port something is already listening on", async () => {
    const busy = PORT_RANGE_START;
    const allocator = new PortAllocator({
      probe: async (port) => port === busy,
      random: sequence([0, 0.5]),
    });
    expect(await allocator.allocate("a")).not.toBe(busy);
  });

  it("fails explicitly rather than colliding at docker run", async () => {
    const allocator = new PortAllocator({
      probe: async () => true,
      attempts: 3,
    });
    await expect(allocator.allocate("a")).rejects.toBeInstanceOf(
      NoFreePortError,
    );
  });

  it("releases a port back into the pool", async () => {
    const allocator = new PortAllocator({
      probe: async () => false,
      random: () => 0,
      attempts: 2,
    });
    const port = await allocator.allocate("a");
    await expect(allocator.allocate("b")).rejects.toBeInstanceOf(
      NoFreePortError,
    );
    allocator.release(port);
    expect(await allocator.allocate("b")).toBe(port);
  });

  it("releases every port an owner holds", async () => {
    const allocator = new PortAllocator({
      probe: async () => false,
      random: sequence([0, 0.5]),
    });
    await allocator.allocate("a");
    await allocator.allocate("a");
    expect(allocator.reservations().size).toBe(2);
    allocator.releaseOwner("a");
    expect(allocator.reservations().size).toBe(0);
  });
});
