import { describe, expect, test } from "bun:test";
import {
  canonicalizePersonEntityRefs,
  type PersonIdentityContext,
} from "./migrate-agent-memory-person-identities";

const ownerPerson = {
  id: "69eb829d267afce917174d54",
  name: "Deniz Lopes Günes",
  email: "denizlg24@gmail.com",
};
const sven = {
  id: "6a4e0f1d425c95b333688202",
  name: "Sven Karlsson",
};
const context: PersonIdentityContext = {
  owner: {
    id: "69380379695ee588ff1efa21",
    name: "Deniz Gunes",
    email: "denizlg24@gmail.com",
  },
  ownerPersonId: ownerPerson.id,
  peopleById: new Map([
    [ownerPerson.id, ownerPerson],
    [sven.id, sven],
  ]),
  peopleByNormalizedName: new Map([
    ["deniz lopes gunes", ownerPerson],
    ["sven karlsson", sven],
  ]),
  personIdByEvidenceEventId: new Map([
    ["df66e179-b439-4789-9fdf-55360116b6ee", ownerPerson.id],
  ]),
};

describe("agent-memory person identity migration", () => {
  test("resolves person evidence UUIDs and owner aliases to the owner", () => {
    expect(
      canonicalizePersonEntityRefs(
        [
          {
            entityType: "person",
            entityId: "df66e179-b439-4789-9fdf-55360116b6ee",
          },
          { entityType: "person", entityId: "admin" },
          {
            entityType: "person",
            entityId: ownerPerson.id,
            label: ownerPerson.name,
          },
        ],
        context,
      ),
    ).toEqual([
      {
        entityType: "person",
        entityId: "owner",
        label: ownerPerson.name,
        resourceId: ownerPerson.id,
      },
    ]);
  });

  test("attaches exact-name slugs to existing directory people", () => {
    expect(
      canonicalizePersonEntityRefs(
        [
          {
            entityType: "person",
            entityId: "sven-karlsson",
            label: "Sven Karlsson",
          },
        ],
        context,
      ),
    ).toEqual([
      {
        entityType: "person",
        entityId: sven.id,
        label: sven.name,
        resourceId: sven.id,
      },
    ]);
  });

  test("leaves unmatched people and non-person refs untouched", () => {
    const refs = [
      {
        entityType: "person" as const,
        entityId: "henrique",
        label: "Henrique",
      },
      {
        entityType: "project" as const,
        entityId: "agent-memory",
        label: "Agent Memory",
      },
    ];
    expect(canonicalizePersonEntityRefs(refs, context)).toEqual(refs);
  });
});
