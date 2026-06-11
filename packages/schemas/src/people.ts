import { z } from "zod";

export const birthdayPartsSchema = z.object({
  month: z.number(),
  day: z.number(),
  year: z.number().nullable().optional(),
});
export type BirthdayParts = z.infer<typeof birthdayPartsSchema>;

export const personSocialSchema = z.object({
  platform: z.string(),
  handle: z.string(),
  url: z.string().optional(),
});
export type IPersonSocial = z.infer<typeof personSocialSchema>;

export const personSchema = z.object({
  _id: z.string(),
  name: z.string(),
  birthday: birthdayPartsSchema.nullable().optional(),
  placeMet: z.string().optional(),
  notes: z.string(),
  photos: z.array(z.string()),
  groupIds: z.array(z.string()),
  email: z.string().optional(),
  phone: z.string().optional(),
  website: z.string().optional(),
  address: z.string().optional(),
  socials: z.array(personSocialSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IPerson = z.infer<typeof personSchema>;

export const personGroupSchema = z.object({
  _id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  color: z.string().optional(),
  parentId: z.string().nullable().optional(),
  autoCreated: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IPersonGroup = z.infer<typeof personGroupSchema>;

export const personEdgeSchema = z.object({
  _id: z.string(),
  from: z.string(),
  to: z.string(),
  strength: z.number(),
  reason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IPersonEdge = z.infer<typeof personEdgeSchema>;

export const personGraphSchema = z.object({
  people: z.array(personSchema),
  groups: z.array(personGroupSchema),
  edges: z.array(personEdgeSchema),
  stats: z.object({
    total: z.number(),
    groups: z.number(),
    edges: z.number(),
  }),
});
export type IPersonGraph = z.infer<typeof personGraphSchema>;
