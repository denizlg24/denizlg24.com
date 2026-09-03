import { describe, expect, it } from "bun:test";

import { DeepSyntheticService, SYNTHETIC_DEPENDENCIES } from "./synthetic";

describe("DeepSyntheticService", () => {
  it("crosses every required dependency", async () => {
    const called: string[] = [];
    const service = new DeepSyntheticService(
      Object.fromEntries(
        SYNTHETIC_DEPENDENCIES.map((name) => [
          name,
          async () => {
            called.push(name);
          },
        ]),
      ) as unknown as ConstructorParameters<typeof DeepSyntheticService>[0],
    );

    const result = await service.check();

    expect(result.status).toBe("ok");
    expect(called.sort()).toEqual([...SYNTHETIC_DEPENDENCIES].sort());
  });

  it("fails the aggregate without skipping neighbouring probes", async () => {
    const called: string[] = [];
    const service = new DeepSyntheticService(
      Object.fromEntries(
        SYNTHETIC_DEPENDENCIES.map((name) => [
          name,
          async () => {
            called.push(name);
            if (name === "redis") throw new Error("write refused");
          },
        ]),
      ) as unknown as ConstructorParameters<typeof DeepSyntheticService>[0],
    );

    const result = await service.check();

    expect(result.status).toBe("down");
    expect(result.checks.redis.error).toBe("write refused");
    expect(called).toHaveLength(SYNTHETIC_DEPENDENCIES.length);
  });
});
