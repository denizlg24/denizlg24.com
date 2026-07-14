import { describe, expect, test } from "bun:test";
import {
  buildAgentMemoryGraph,
  type GraphMemoryInput,
  type GraphSimilarityInput,
  ownerRefMatcher,
} from "./graph";

function memory(overrides: Partial<GraphMemoryInput> = {}): GraphMemoryInput {
  return {
    id: "memory-1",
    statement: "Deniz is studying Calculus II at FEUP.",
    memoryType: "semantic",
    status: "active",
    confidence: 0.9,
    importance: 0.7,
    entityRefs: [],
    contradictionIds: [],
    ...overrides,
  };
}

const NO_SIMILARITY: GraphSimilarityInput = {
  embeddedMemoryIds: [],
  similarLinks: [],
};

describe("agent memory graph builder", () => {
  test("creates entity nodes only for shared entities and links members", () => {
    const shared = {
      entityType: "course",
      entityId: "calc-2",
      label: "Calculus II",
    };
    const graph = buildAgentMemoryGraph(
      [
        memory({ id: "m1", entityRefs: [shared] }),
        memory({ id: "m2", entityRefs: [shared] }),
        memory({
          id: "m3",
          entityRefs: [{ entityType: "person", entityId: "p1", label: "Ana" }],
        }),
      ],
      NO_SIMILARITY,
    );
    const entityNodes = graph.nodes.filter((node) => node.kind === "entity");
    expect(entityNodes).toHaveLength(1);
    expect(entityNodes[0]?.id).toBe("entity:course:calc-2");
    expect(entityNodes[0]?.label).toBe("Calculus II");
    expect(entityNodes[0]?.count).toBe(2);
    expect(
      graph.links.filter((link) => link.type === "entity").map((l) => l.target),
    ).toEqual(["m1", "m2"]);
  });

  test("adds contradiction and supersession links only between present nodes", () => {
    const graph = buildAgentMemoryGraph(
      [
        memory({ id: "m1", contradictionIds: ["m2", "missing"] }),
        memory({ id: "m2", supersedesMemoryId: "m1" }),
      ],
      NO_SIMILARITY,
    );
    const types = graph.links.map((link) => link.type).sort();
    expect(types).toEqual(["contradiction", "supersession"]);
  });

  test("keeps precomputed similar links only between present nodes, deduplicated", () => {
    const graph = buildAgentMemoryGraph(
      [memory({ id: "m1" }), memory({ id: "m2" })],
      {
        embeddedMemoryIds: ["m1", "m2"],
        similarLinks: [
          { source: "m1", target: "m2", type: "similar", strength: 0.8 },
          { source: "m2", target: "m1", type: "similar", strength: 0.7 },
          { source: "m1", target: "gone", type: "similar", strength: 0.9 },
        ],
      },
    );
    const similar = graph.links.filter((link) => link.type === "similar");
    expect(similar).toHaveLength(1);
    expect(similar[0]).toEqual({
      source: "m1",
      target: "m2",
      type: "similar",
      strength: 0.8,
    });
  });

  test("merges scattered owner person refs into one highlighted owner node", () => {
    const owner = { name: "Deniz Gunes", email: "denizlg24@gmail.com" };
    const matcher = ownerRefMatcher(owner);
    expect(
      matcher({
        entityType: "person",
        entityId: "deniz-gunes",
        label: "Deniz Günes",
      }),
    ).toBe(true);
    expect(matcher({ entityType: "person", entityId: "deniz" })).toBe(true);
    expect(
      matcher({ entityType: "person", entityId: "denizlg24@gmail.com" }),
    ).toBe(true);
    expect(
      matcher({
        entityType: "person",
        entityId: "user",
        label: "Deniz Lopes Gunes",
      }),
    ).toBe(true);
    expect(
      matcher({ entityType: "person", entityId: "user", label: "Deniz Gunes" }),
    ).toBe(true);
    expect(matcher({ entityType: "person", entityId: "user" })).toBe(false);
    expect(
      matcher({
        entityType: "person",
        entityId: "sven-karlsson",
        label: "Sven",
      }),
    ).toBe(false);
    expect(
      matcher({
        entityType: "project",
        entityId: "deniz-cloud",
        label: "Deniz Cloud",
      }),
    ).toBe(false);

    const graph = buildAgentMemoryGraph(
      [
        memory({
          id: "m1",
          entityRefs: [
            {
              entityType: "person",
              entityId: "deniz-gunes",
              label: "Deniz Günes",
            },
          ],
        }),
        memory({
          id: "m2",
          entityRefs: [
            {
              entityType: "person",
              entityId: "denizlg24@gmail.com",
              label: "Deniz Gunes",
            },
          ],
        }),
      ],
      NO_SIMILARITY,
      owner,
    );
    const ownerNodes = graph.nodes.filter((node) => node.isOwner);
    expect(ownerNodes).toHaveLength(1);
    expect(ownerNodes[0]?.id).toBe("entity:person:owner");
    expect(ownerNodes[0]?.label).toBe("Deniz Gunes");
    expect(ownerNodes[0]?.count).toBe(2);
  });

  test("always emits the owner node even without owner-linked memories", () => {
    const graph = buildAgentMemoryGraph([memory()], NO_SIMILARITY, {
      name: "Deniz Gunes",
      email: "denizlg24@gmail.com",
    });
    const ownerNode = graph.nodes.find((node) => node.isOwner);
    expect(ownerNode?.count).toBe(0);
  });

  test("marks embedded memories and truncates long labels", () => {
    const graph = buildAgentMemoryGraph(
      [memory({ id: "m1", statement: "x".repeat(200) }), memory({ id: "m2" })],
      { embeddedMemoryIds: ["m1", "ghost"], similarLinks: [] },
    );
    expect(graph.embeddedCount).toBe(1);
    const m1 = graph.nodes.find((node) => node.id === "m1");
    expect(m1?.hasEmbedding).toBe(true);
    expect(m1?.label.length).toBeLessThanOrEqual(141);
    expect(graph.nodes.find((node) => node.id === "m2")?.hasEmbedding).toBe(
      false,
    );
  });
});
