import { describe, expect, test } from "bun:test";
import {
  buildPersonEntityClusters,
  matchExistingPeople,
  personDraftIsComplete,
  resolveAttachedPersonResourceId,
  splitPersonEntityRefs,
} from "./resource-suggestions";

const owner = { name: "Deniz Lopes Günes", email: "owner@example.com" };

function memory(
  id: string,
  refs: {
    entityId: string;
    label?: string;
    entityType?: string;
    resourceId?: string;
  }[],
) {
  return {
    id,
    statement: `statement ${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    entityRefs: refs.map((ref) => ({
      entityType: ref.entityType ?? "person",
      entityId: ref.entityId,
      label: ref.label,
      resourceId: ref.resourceId,
    })),
  };
}

describe("buildPersonEntityClusters", () => {
  test("groups memories per person entity and sorts by cluster size", () => {
    const clusters = buildPersonEntityClusters([
      memory("m1", [{ entityId: "henrique", label: "Henrique" }]),
      memory("m2", [{ entityId: "henrique" }]),
      memory("m3", [{ entityId: "sofia", label: "Sofia" }]),
    ]);
    expect(clusters).toEqual([
      {
        entityKey: "person:henrique",
        label: "Henrique",
        memoryIds: ["m1", "m2"],
        resourceIds: [],
      },
      {
        entityKey: "person:sofia",
        label: "Sofia",
        memoryIds: ["m3"],
        resourceIds: [],
      },
    ]);
  });

  test("excludes the owner and non-person refs", () => {
    const clusters = buildPersonEntityClusters(
      [
        memory("m1", [
          { entityId: "deniz", label: "Deniz" },
          { entityId: "deniz-gunes", label: "Deniz Günes" },
          { entityId: "pi-cloud", entityType: "project" },
          { entityId: "henrique", label: "Henrique" },
        ]),
      ],
      owner,
    );
    expect(clusters).toEqual([
      {
        entityKey: "person:henrique",
        label: "Henrique",
        memoryIds: ["m1"],
        resourceIds: [],
      },
    ]);
  });

  test("counts a memory once per entity and falls back to the entity id", () => {
    const clusters = buildPersonEntityClusters([
      memory("m1", [{ entityId: "henrique" }, { entityId: "henrique" }]),
    ]);
    expect(clusters).toEqual([
      {
        entityKey: "person:henrique",
        label: "henrique",
        memoryIds: ["m1"],
        resourceIds: [],
      },
    ]);
  });

  test("retains attached person resource ids for the entity", () => {
    const clusters = buildPersonEntityClusters([
      memory("m1", [
        {
          entityId: "sereffatin-gunes",
          label: "Sereffatin Gunes",
          resourceId: "person-record-1",
        },
      ]),
      memory("m2", [
        {
          entityId: "sereffatin-gunes",
          label: "Sereffatin Gunes",
          resourceId: "person-record-1",
        },
      ]),
    ]);
    expect(clusters[0]?.resourceIds).toEqual(["person-record-1"]);
  });
});

describe("splitPersonEntityRefs", () => {
  test("moves only the selected person identity and clears its attachment", () => {
    expect(
      splitPersonEntityRefs(
        [
          {
            entityType: "person",
            entityId: "nuno",
            label: "Nuno",
            resourceId: "wrong-person",
          },
          { entityType: "project", entityId: "project-1", label: "Project" },
        ],
        "nuno",
        "person-split-memory-1",
      ),
    ).toEqual({
      changed: true,
      entityRefs: [
        {
          entityType: "person",
          entityId: "person-split-memory-1",
          label: "Nuno",
        },
        { entityType: "project", entityId: "project-1", label: "Project" },
      ],
    });
  });
});

describe("personDraftIsComplete", () => {
  const base = {
    name: "Henrique Sousa",
    relationToOwner: "University friend",
    notes: "Met at FEUP; climbs with Admin on Tuesdays.",
  };

  test("accepts a named person with optional enrichment", () => {
    expect(personDraftIsComplete(base)).toBe(true);
    expect(
      personDraftIsComplete({
        name: "Henrique",
        relationToOwner: "",
        notes: "",
      }),
    ).toBe(true);
  });

  test("rejects an empty name", () => {
    expect(personDraftIsComplete({ ...base, name: " " })).toBe(false);
  });
});

describe("resolveAttachedPersonResourceId", () => {
  const cluster = {
    entityKey: "person:sereffatin-gunes",
    label: "Sereffatin Gunes",
    memoryIds: ["m1"],
    resourceIds: [],
  };

  test("leaves an organic person entity unattached even after one mention", () => {
    expect(resolveAttachedPersonResourceId(cluster, new Set())).toBeUndefined();
  });

  test("recognizes explicit, direct-id, and legacy accepted attachments", () => {
    expect(
      resolveAttachedPersonResourceId(
        { ...cluster, resourceIds: ["person-record-1"] },
        new Set(["person-record-1"]),
      ),
    ).toBe("person-record-1");
    expect(
      resolveAttachedPersonResourceId(
        { ...cluster, entityKey: "person:person-record-2" },
        new Set(["person-record-2"]),
      ),
    ).toBe("person-record-2");
    expect(
      resolveAttachedPersonResourceId(
        cluster,
        new Set(["person-record-3"]),
        "person-record-3",
      ),
    ).toBe("person-record-3");
  });
});

describe("matchExistingPeople", () => {
  const people = [
    { id: "p1", name: "Henrique Sousa" },
    { id: "p2", name: "Sofia" },
    { id: "p3", name: "Miguel Costa" },
  ];

  test("flags an exact normalized full-name match", () => {
    const result = matchExistingPeople(["henrique  sousa"], people);
    expect(result.exact).toBe(true);
    expect(result.matches).toEqual([
      { resourceId: "p1", name: "Henrique Sousa" },
    ]);
  });

  test("token-subset overlap matches without being exact", () => {
    const result = matchExistingPeople(["Henrique"], people);
    expect(result.exact).toBe(false);
    expect(result.matches).toEqual([
      { resourceId: "p1", name: "Henrique Sousa" },
    ]);
  });

  test("returns nothing for unrelated names", () => {
    const result = matchExistingPeople(["Joana Alves"], people);
    expect(result.exact).toBe(false);
    expect(result.matches).toEqual([]);
  });
});
