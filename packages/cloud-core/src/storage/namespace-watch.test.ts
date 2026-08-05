import { describe, expect, it } from "bun:test";

import { isReservedSegment } from "./metadata-resolve";
import { watchPathToRelative } from "./namespace-watch";

describe("watch path normalisation", () => {
  it("produces the unprefixed form the projection stores", () => {
    // The repository prepends the slash itself; a leading one here would make
    // every projected path double-separated and match nothing.
    expect(watchPathToRelative("a/b.txt", isReservedSegment)).toBe("a/b.txt");
    expect(watchPathToRelative("/a/b.txt", isReservedSegment)).toBe("a/b.txt");
  });

  it("drops reserved bookkeeping entries", () => {
    expect(
      watchPathToRelative(".denizcloud-mount-witness", isReservedSegment),
    ).toBeNull();
    expect(
      watchPathToRelative("a/.denizcloud-branch.json", isReservedSegment),
    ).toBeNull();
    expect(watchPathToRelative("a/._sidecar", isReservedSegment)).toBeNull();
  });

  it("refuses traversal and empty names", () => {
    expect(watchPathToRelative("../escape", isReservedSegment)).toBeNull();
    expect(watchPathToRelative("a/../b", isReservedSegment)).toBeNull();
    expect(watchPathToRelative("", isReservedSegment)).toBeNull();
    expect(watchPathToRelative(null, isReservedSegment)).toBeNull();
  });
});
