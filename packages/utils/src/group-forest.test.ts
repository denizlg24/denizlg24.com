import { describe, expect, it } from "bun:test";
import {
  ancestorIds,
  descendantIdSet,
  groupByParent,
  indexById,
} from "./group-forest";

interface Node {
  _id: string;
  parentId: string | null;
  name: string;
}

// root -> child -> grandchild, plus a sibling of child under root.
const forest: Node[] = [
  { _id: "root", parentId: null, name: "Root" },
  { _id: "child", parentId: "root", name: "Beta" },
  { _id: "grandchild", parentId: "child", name: "Gamma" },
  { _id: "sibling", parentId: "root", name: "Alpha" },
];

const getId = (node: Node) => node._id;
const getParentId = (node: Node) => node.parentId;

describe("indexById", () => {
  it("maps each node by its id", () => {
    const byId = indexById(forest, getId);
    expect(byId.size).toBe(4);
    expect(byId.get("grandchild")?.name).toBe("Gamma");
  });

  it("returns an empty map for empty input", () => {
    expect(indexById([], getId).size).toBe(0);
  });
});

describe("groupByParent", () => {
  it("groups children under their parent id (null for roots)", () => {
    const byParent = groupByParent(forest, getParentId);
    expect(byParent.get(null)?.map(getId)).toEqual(["root"]);
    expect(byParent.get("root")?.map(getId).sort()).toEqual([
      "child",
      "sibling",
    ]);
    expect(byParent.get("child")?.map(getId)).toEqual(["grandchild"]);
  });

  it("applies the comparator (name order)", () => {
    const byParent = groupByParent(forest, getParentId, (a, b) =>
      a.name.localeCompare(b.name),
    );
    // Alpha (sibling) sorts before Beta (child).
    expect(byParent.get("root")?.map(getId)).toEqual(["sibling", "child"]);
  });

  it("returns an empty map for empty input", () => {
    expect(groupByParent<Node>([], getParentId).size).toBe(0);
  });
});

describe("ancestorIds", () => {
  const byId = indexById(forest, getId);
  const parentOf = (id: string) => byId.get(id)?.parentId ?? null;

  it("includes self when includeSelf is true (near-to-far)", () => {
    expect(ancestorIds("grandchild", parentOf, { includeSelf: true })).toEqual([
      "grandchild",
      "child",
      "root",
    ]);
  });

  it("excludes self when includeSelf is false (strict ancestors)", () => {
    expect(ancestorIds("grandchild", parentOf, { includeSelf: false })).toEqual(
      ["child", "root"],
    );
  });

  it("returns just self / nothing for a root", () => {
    expect(ancestorIds("root", parentOf, { includeSelf: true })).toEqual([
      "root",
    ]);
    expect(ancestorIds("root", parentOf, { includeSelf: false })).toEqual([]);
  });
});

describe("descendantIdSet", () => {
  const byParent = groupByParent(forest, getParentId);

  it("includes the root when includeRoot is true", () => {
    const set = descendantIdSet("root", byParent, getId, { includeRoot: true });
    expect([...set].sort()).toEqual(["child", "grandchild", "root", "sibling"]);
  });

  it("excludes the root when includeRoot is false", () => {
    const set = descendantIdSet("root", byParent, getId, {
      includeRoot: false,
    });
    expect([...set].sort()).toEqual(["child", "grandchild", "sibling"]);
  });

  it("returns only self / empty for a leaf", () => {
    expect([
      ...descendantIdSet("grandchild", byParent, getId, {
        includeRoot: true,
      }),
    ]).toEqual(["grandchild"]);
    expect(
      descendantIdSet("grandchild", byParent, getId, { includeRoot: false })
        .size,
    ).toBe(0);
  });
});

describe("cycle safety", () => {
  // A.parent = B, B.parent = A.
  const cyclic: Node[] = [
    { _id: "A", parentId: "B", name: "A" },
    { _id: "B", parentId: "A", name: "B" },
  ];
  const byId = indexById(cyclic, getId);
  const parentOf = (id: string) => byId.get(id)?.parentId ?? null;
  const byParent = groupByParent(cyclic, getParentId);

  it("terminates and bounds ancestor traversal", () => {
    const result = ancestorIds("A", parentOf, { includeSelf: true });
    expect([...result].sort()).toEqual(["A", "B"]);
  });

  it("terminates and bounds descendant traversal", () => {
    const result = descendantIdSet("A", byParent, getId, { includeRoot: true });
    expect([...result].sort()).toEqual(["A", "B"]);
  });
});
