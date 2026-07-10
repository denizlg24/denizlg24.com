import {
  createPerson,
  createPersonGroup,
  deletePerson,
  deletePersonGroup,
  getPeopleGraph,
  getPersonById,
  getPersonEdges,
  listPersonGroups,
  replaceRelations,
  updatePerson,
  updatePersonGroup,
} from "@/lib/people";
import type { ToolDefinition } from "./types";

const PERSON_FIELD_PROPERTIES = {
  birthday: {
    type: "object",
    description:
      "Birthday as { month: 1-12, day: 1-31, year?: number | null }. Pass null to clear.",
    properties: {
      month: { type: "number" },
      day: { type: "number" },
      year: { type: "number" },
    },
  },
  placeMet: {
    type: "string",
    description: "Where you met this person (optional)",
  },
  notes: { type: "string", description: "Free-form notes (optional)" },
  email: { type: "string", description: "Email address (optional)" },
  phone: { type: "string", description: "Phone number (optional)" },
  website: { type: "string", description: "Website URL (optional)" },
  address: { type: "string", description: "Postal address (optional)" },
  socials: {
    type: "array",
    description:
      "Social profiles, each { platform, handle, url? }. Replaces the full list when provided.",
    items: {
      type: "object",
      properties: {
        platform: { type: "string" },
        handle: { type: "string" },
        url: { type: "string" },
      },
      required: ["platform", "handle"],
      additionalProperties: false,
    },
  },
  groupIds: {
    type: "array",
    description:
      "Group IDs this person belongs to (from list_person_groups). Replaces the full list when provided; redundant ancestor groups are pruned automatically.",
    items: { type: "string" },
  },
  relations: {
    type: "array",
    description:
      "Relations to other people, each { personId, reason? }. WARNING: replaces ALL existing relations for this person when provided — include every relation that should remain.",
    items: {
      type: "object",
      properties: {
        personId: { type: "string" },
        reason: {
          type: "string",
          description: "How they are related, e.g. 'roommate', 'lab partner'",
        },
      },
      required: ["personId"],
      additionalProperties: false,
    },
  },
};

function collectPersonBody(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of [
    "name",
    "birthday",
    "placeMet",
    "notes",
    "email",
    "phone",
    "website",
    "address",
    "socials",
    "groupIds",
    "relations",
  ]) {
    if (input[key] !== undefined) body[key] = input[key];
  }
  return body;
}

export const peopleTools: ToolDefinition[] = [
  {
    schema: {
      name: "list_people",
      description:
        "List everyone in the people graph: each person's id, name, contact info, birthday, group memberships (resolved to names), and relation count, plus the group tree and graph stats. Call this first to find a person's id.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "people",
    execute: async () => {
      const graph = await getPeopleGraph();
      const groupNames = new Map(
        graph.groups.map((group) => [group._id, group.name]),
      );
      const relationCounts = new Map<string, number>();
      for (const edge of graph.edges) {
        relationCounts.set(edge.from, (relationCounts.get(edge.from) ?? 0) + 1);
        relationCounts.set(edge.to, (relationCounts.get(edge.to) ?? 0) + 1);
      }
      return {
        people: graph.people.map((person) => ({
          _id: person._id,
          name: person.name,
          email: person.email,
          phone: person.phone,
          birthday: person.birthday ?? null,
          placeMet: person.placeMet,
          groups: person.groupIds.map(
            (groupId) => groupNames.get(groupId) ?? groupId,
          ),
          relationCount: relationCounts.get(person._id) ?? 0,
        })),
        groups: graph.groups.map((group) => ({
          _id: group._id,
          name: group.name,
          parentId: group.parentId,
        })),
        stats: graph.stats,
      };
    },
  },
  {
    schema: {
      name: "get_person",
      description:
        "Get one person's full record: contact details, birthday, notes, socials, groups (resolved to names), and every relation resolved to the related person's name and reason.",
      input_schema: {
        type: "object",
        properties: {
          personId: { type: "string", description: "Person ID" },
        },
        required: ["personId"],
      },
    },
    isWrite: false,
    category: "people",
    execute: async (input) => {
      const personId = input.personId as string;
      const person = await getPersonById(personId);
      if (!person) throw new Error("Person not found");

      const [edges, groups] = await Promise.all([
        getPersonEdges(personId),
        listPersonGroups(),
      ]);
      const groupNames = new Map(
        groups.map((group) => [group._id, group.name]),
      );

      const relatedIds = edges.map((edge) =>
        edge.from === personId ? edge.to : edge.from,
      );
      const relatedPeople = await Promise.all(
        relatedIds.map((id) => getPersonById(id)),
      );
      const nameById = new Map(
        relatedPeople
          .filter((related): related is NonNullable<typeof related> =>
            Boolean(related),
          )
          .map((related) => [related._id, related.name]),
      );

      return {
        ...person,
        groups: person.groupIds.map((groupId) => ({
          _id: groupId,
          name: groupNames.get(groupId) ?? groupId,
        })),
        relations: edges.map((edge) => {
          const relatedId = edge.from === personId ? edge.to : edge.from;
          return {
            personId: relatedId,
            name: nameById.get(relatedId) ?? relatedId,
            reason: edge.reason,
          };
        }),
      };
    },
  },
  {
    schema: {
      name: "create_person",
      description:
        "Add a person to the people graph. Only name is required. Creating a person with a birthday also creates recurring birthday calendar events.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Person's name" },
          ...PERSON_FIELD_PROPERTIES,
        },
        required: ["name"],
      },
    },
    isWrite: true,
    category: "people",
    execute: async (input) => {
      const person = await createPerson(collectPersonBody(input));
      if (!person) throw new Error("Failed to create person (name required)");
      return { _id: person._id, name: person.name };
    },
  },
  {
    schema: {
      name: "update_person",
      description:
        "Update a person's details. Only provided fields change. Providing relations replaces ALL existing relations — prefer set_person_relations for relation-only edits. Changing name or birthday re-syncs birthday calendar events.",
      input_schema: {
        type: "object",
        properties: {
          personId: { type: "string", description: "Person ID" },
          name: { type: "string", description: "New name (optional)" },
          ...PERSON_FIELD_PROPERTIES,
        },
        required: ["personId"],
      },
    },
    isWrite: true,
    category: "people",
    execute: async (input) => {
      const person = await updatePerson(
        input.personId as string,
        collectPersonBody(input),
      );
      if (!person) throw new Error("Person not found");
      return { _id: person._id, name: person.name };
    },
  },
  {
    schema: {
      name: "delete_person",
      description:
        "Permanently delete a person, their relations, and their birthday calendar events. Cannot be undone.",
      input_schema: {
        type: "object",
        properties: {
          personId: { type: "string", description: "Person ID" },
        },
        required: ["personId"],
      },
    },
    isWrite: true,
    category: "people",
    execute: async (input) => {
      const deleted = await deletePerson(input.personId as string);
      if (!deleted) throw new Error("Person not found");
      return { deleted: true };
    },
  },
  {
    schema: {
      name: "set_person_relations",
      description:
        "Replace a person's full set of relations to other people. Pass every relation that should exist afterwards — omitted relations are removed. Use get_person first to see current relations.",
      input_schema: {
        type: "object",
        properties: {
          personId: { type: "string", description: "Person ID" },
          relations: {
            type: "array",
            description:
              "Complete list of relations, each { personId, reason? }. An empty array removes all relations.",
            items: {
              type: "object",
              properties: {
                personId: { type: "string" },
                reason: { type: "string" },
              },
              required: ["personId"],
              additionalProperties: false,
            },
          },
        },
        required: ["personId", "relations"],
      },
    },
    isWrite: true,
    category: "people",
    execute: async (input) => {
      const personId = input.personId as string;
      const person = await getPersonById(personId);
      if (!person) throw new Error("Person not found");
      await replaceRelations(
        personId,
        Array.isArray(input.relations) ? input.relations : [],
      );
      const edges = await getPersonEdges(personId);
      return { _id: personId, relationCount: edges.length };
    },
  },
  {
    schema: {
      name: "list_person_groups",
      description:
        "List all people groups (e.g. family, university, work) with their ids, colors, and parent-group hierarchy.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    isWrite: false,
    category: "people",
    execute: async () => {
      return await listPersonGroups();
    },
  },
  {
    schema: {
      name: "create_person_group",
      description:
        "Create a people group. Groups can nest via parentId; people inherit membership of ancestor groups implicitly.",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Group name" },
          description: {
            type: "string",
            description: "Description (optional)",
          },
          color: { type: "string", description: "Color in hex (optional)" },
          parentId: {
            type: "string",
            description: "Parent group ID for nesting (optional)",
          },
        },
        required: ["name"],
      },
    },
    isWrite: true,
    category: "people",
    execute: async (input) => {
      const group = await createPersonGroup({
        name: input.name,
        description: input.description,
        color: input.color,
        parentId: input.parentId,
      });
      if (!group) throw new Error("Failed to create group (name required)");
      return { _id: group._id, name: group.name };
    },
  },
  {
    schema: {
      name: "update_person_group",
      description:
        "Update a people group's name, description, color, or parent. Pass parentId null to make it a root group.",
      input_schema: {
        type: "object",
        properties: {
          groupId: { type: "string", description: "Group ID" },
          name: { type: "string", description: "New name (optional)" },
          description: {
            type: "string",
            description: "New description (optional)",
          },
          color: { type: "string", description: "New color (optional)" },
          parentId: {
            type: "string",
            description:
              "New parent group ID, or null to detach from its parent (optional)",
          },
        },
        required: ["groupId"],
      },
    },
    isWrite: true,
    category: "people",
    execute: async (input) => {
      const body: Record<string, unknown> = {};
      for (const key of ["name", "description", "color", "parentId"]) {
        if (input[key] !== undefined) body[key] = input[key];
      }
      const group = await updatePersonGroup(input.groupId as string, body);
      if (!group) throw new Error("Group not found");
      return { _id: group._id, name: group.name, parentId: group.parentId };
    },
  },
  {
    schema: {
      name: "delete_person_group",
      description:
        "Delete a people group. Members are removed from it, and child groups become root groups. People themselves are not deleted.",
      input_schema: {
        type: "object",
        properties: {
          groupId: { type: "string", description: "Group ID" },
        },
        required: ["groupId"],
      },
    },
    isWrite: true,
    category: "people",
    execute: async (input) => {
      const deleted = await deletePersonGroup(input.groupId as string);
      if (!deleted) throw new Error("Group not found");
      return { deleted: true };
    },
  },
];
