import { describe, expect, test } from "bun:test";
import {
  buildPersonEntityClusters,
  matchExistingPeople,
  parseResourceSuggestionResult,
  personDraftIsComplete,
} from "./resource-suggestions";

const owner = { name: "Deniz Lopes Günes", email: "denizlolcsgo@gmail.com" };

function memory(
  id: string,
  refs: { entityId: string; label?: string; entityType?: string }[],
) {
  return {
    id,
    statement: `statement ${id}`,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    entityRefs: refs.map((ref) => ({
      entityType: ref.entityType ?? "person",
      entityId: ref.entityId,
      label: ref.label,
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
      },
      { entityKey: "person:sofia", label: "Sofia", memoryIds: ["m3"] },
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
      { entityKey: "person:henrique", label: "Henrique", memoryIds: ["m1"] },
    ]);
  });

  test("counts a memory once per entity and falls back to the entity id", () => {
    const clusters = buildPersonEntityClusters([
      memory("m1", [{ entityId: "henrique" }, { entityId: "henrique" }]),
    ]);
    expect(clusters).toEqual([
      { entityKey: "person:henrique", label: "henrique", memoryIds: ["m1"] },
    ]);
  });
});

describe("personDraftIsComplete", () => {
  const base = {
    name: "Henrique Sousa",
    relationToOwner: "University friend",
    notes: "Met at FEUP; climbs with Admin on Tuesdays.",
  };

  test("accepts a full name with relation and notes", () => {
    expect(personDraftIsComplete(base)).toBe(true);
  });

  test("rejects a bare first name", () => {
    expect(personDraftIsComplete({ ...base, name: "Henrique" })).toBe(false);
    expect(personDraftIsComplete({ ...base, name: "  Henrique  " })).toBe(
      false,
    );
  });

  test("rejects whitespace-only relation or notes", () => {
    expect(personDraftIsComplete({ ...base, relationToOwner: "  " })).toBe(
      false,
    );
    expect(personDraftIsComplete({ ...base, notes: " " })).toBe(false);
  });

  test("normalizes accents when counting name tokens", () => {
    expect(personDraftIsComplete({ ...base, name: "José-María Núñez" })).toBe(
      true,
    );
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

describe("parseResourceSuggestionResult", () => {
  test("accepts a well-formed suggestion payload", () => {
    const parsed = parseResourceSuggestionResult({
      suggestions: [
        {
          entityKey: "person:henrique",
          draft: {
            name: "Henrique Sousa",
            relationToOwner: "University friend",
            notes: "Climbs with Admin.",
          },
          confidence: 0.8,
          reason: "Recurring climbing partner across five memories.",
        },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects drafts missing the relation to the owner", () => {
    const parsed = parseResourceSuggestionResult({
      suggestions: [
        {
          entityKey: "person:henrique",
          draft: { name: "Henrique Sousa", notes: "Climbs with Admin." },
          confidence: 0.8,
          reason: "Recurring person.",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });
});
