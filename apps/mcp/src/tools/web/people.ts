import type { McpServer } from "@modelcontextprotocol/server";
import { birthdayPartsSchema, personSocialSchema } from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p, partial } from "../define";

const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });

const relation = z.object({
  personId: z.string().min(1),
  reason: z.string().optional(),
});

const personFields = {
  name: z.string().min(1),
  birthday: birthdayPartsSchema.nullable().optional(),
  placeMet: z.string().optional(),
  notes: z.string().optional(),
  photos: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  socials: z.array(personSocialSchema).optional(),
  relations: z
    .array(relation)
    .optional()
    .describe("Replaces every edge touching this person"),
};

const groupFields = {
  name: z.string().min(1),
  description: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
};

export function registerWebPeople(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_people",
    title: "Web: people",
    description: "People graph: contacts, their groups and relations.",
    actions: {
      list: action({
        description: "Every person, group and edge plus counts",
        readOnly: true,
        run: () => api.web.get("/api/admin/people"),
      }),
      get: action({
        description: "One person",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/people/${id}`),
      }),
      create: action({
        description: "Adds a person (name required); syncs birthday events",
        input: z.object(personFields),
        run: (body) => api.web.post("/api/admin/people", body),
      }),
      update: action({
        description: "Changes any field; birthday null clears it",
        input: z.object({ id, ...partial(personFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/people/${id}`, body),
      }),
      delete: action({
        description: "Deletes a person and its edges",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/people/${id}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_people_groups",
    title: "Web: people groups",
    description: "Groups people belong to; nestable through parentId.",
    actions: {
      list: action({
        description: "Every group",
        readOnly: true,
        run: () => api.web.get("/api/admin/people/groups"),
      }),
      create: action({
        description: "Adds a group",
        input: z.object(groupFields),
        run: (body) => api.web.post("/api/admin/people/groups", body),
      }),
      update: action({
        description: "Changes any field; parentId null or empty unnests",
        input: z.object({ id, ...partial(groupFields) }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/people/groups/${id}`, body),
      }),
      delete: action({
        description: "Deletes a group",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/people/groups/${id}`),
      }),
    },
  });
}
