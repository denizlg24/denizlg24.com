import mongoose from "mongoose";
import { observeDomainRecordSafely } from "@/lib/agent-memory/domain-evidence";
import { syncBirthdayEventsForPerson } from "@/lib/calendar-sync";
import { connectDB } from "@/lib/mongodb";
import {
  buildAncestorMap,
  pruneRedundantAncestors,
} from "@/lib/note-group-hierarchy";
import {
  canonicalPersonPair,
  parsePersonSocials,
  prunePersonGroupIds,
  serializePerson,
  serializePersonEdge,
  serializePersonGroup,
} from "@/lib/people-route-utils";
import { getAppTimeZone, inTz } from "@/lib/timezone";
import { CalendarEvent } from "@/models/CalendarEvent";
import { type BirthdayParts, type ILeanPerson, Person } from "@/models/Person";
import { type ILeanPersonEdge, PersonEdge } from "@/models/PersonEdge";
import { type ILeanPersonGroup, PersonGroup } from "@/models/PersonGroup";

export type PersonWire = ReturnType<typeof serializePerson>;
export type PersonGroupWire = ReturnType<typeof serializePersonGroup>;
export type PersonEdgeWire = ReturnType<typeof serializePersonEdge>;

export function parseBirthday(
  value: unknown,
): BirthdayParts | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;

  const birthday = value as Record<string, unknown>;
  const month = Number(birthday.month);
  const day = Number(birthday.day);
  const year =
    birthday.year === null ||
    birthday.year === undefined ||
    birthday.year === ""
      ? null
      : Number(birthday.year);

  if (!Number.isInteger(month) || month < 1 || month > 12) return undefined;
  if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  if (year !== null && (!Number.isInteger(year) || year < 1)) return undefined;

  return { month, day, year };
}

export function parsePhotos(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((photo): photo is string => typeof photo === "string")
    : [];
}

export async function replaceRelations(personId: string, relations: unknown) {
  if (!Array.isArray(relations)) return;

  await PersonEdge.deleteMany({
    $or: [{ from: personId }, { to: personId }],
  }).exec();

  const operations = relations
    .map((relation) => {
      if (!relation || typeof relation !== "object") return null;
      const data = relation as Record<string, unknown>;
      const relatedId = data.personId ?? data.to ?? data.from;
      if (
        typeof relatedId !== "string" ||
        relatedId === personId ||
        !mongoose.Types.ObjectId.isValid(relatedId)
      ) {
        return null;
      }

      const [from, to] = canonicalPersonPair(personId, relatedId);
      const fromId = new mongoose.Types.ObjectId(from);
      const toId = new mongoose.Types.ObjectId(to);
      return {
        updateOne: {
          filter: { from: fromId, to: toId },
          update: {
            $set: {
              from: fromId,
              to: toId,
              strength: 1,
              reason: typeof data.reason === "string" ? data.reason : undefined,
            },
          },
          upsert: true,
        },
      };
    })
    .filter((operation): operation is NonNullable<typeof operation> =>
      Boolean(operation),
    );

  if (operations.length > 0) {
    await PersonEdge.bulkWrite(operations);
  }
}

export async function getPeopleGraph() {
  await connectDB();
  const [people, groups, edges] = await Promise.all([
    Person.find().sort({ updatedAt: -1 }).lean<ILeanPerson[]>().exec(),
    PersonGroup.find().sort({ name: 1 }).lean<ILeanPersonGroup[]>().exec(),
    PersonEdge.find().lean<ILeanPersonEdge[]>().exec(),
  ]);

  return {
    people: people.map(serializePerson),
    groups: groups.map(serializePersonGroup),
    edges: edges.map(serializePersonEdge),
    stats: {
      total: people.length,
      groups: groups.length,
      edges: edges.length,
    },
  };
}

export async function getPersonById(id: string): Promise<PersonWire | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  await connectDB();
  const person = await Person.findById(id).lean<ILeanPerson>().exec();
  return person ? serializePerson(person) : null;
}

export async function getPeopleByIds(ids: string[]): Promise<PersonWire[]> {
  const validIds = [
    ...new Set(ids.filter((id) => mongoose.Types.ObjectId.isValid(id))),
  ];
  if (validIds.length === 0) return [];
  await connectDB();
  const people = await Person.find({ _id: { $in: validIds } })
    .lean<ILeanPerson[]>()
    .exec();
  return people.map(serializePerson);
}

export async function getPersonEdges(
  personId: string,
): Promise<PersonEdgeWire[]> {
  if (!mongoose.Types.ObjectId.isValid(personId)) return [];
  await connectDB();
  const edges = await PersonEdge.find({
    $or: [{ from: personId }, { to: personId }],
  })
    .lean<ILeanPersonEdge[]>()
    .exec();
  return edges.map(serializePersonEdge);
}

export async function createPerson(
  body: Record<string, unknown>,
): Promise<PersonWire | null> {
  if (typeof body.name !== "string" || !body.name.trim()) return null;

  await connectDB();
  const birthday = parseBirthday(body.birthday);
  const groupIds = await prunePersonGroupIds(
    Array.isArray(body.groupIds)
      ? body.groupIds.filter(
          (groupId): groupId is string => typeof groupId === "string",
        )
      : [],
  );

  const person = await Person.create({
    name: body.name.trim(),
    birthday,
    placeMet: typeof body.placeMet === "string" ? body.placeMet : undefined,
    notes: typeof body.notes === "string" ? body.notes : "",
    photos: parsePhotos(body.photos),
    groupIds,
    email: typeof body.email === "string" ? body.email.trim() : undefined,
    phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
    website: typeof body.website === "string" ? body.website.trim() : undefined,
    address: typeof body.address === "string" ? body.address.trim() : undefined,
    socials: parsePersonSocials(body.socials) ?? [],
  });

  await replaceRelations(String(person._id), body.relations);
  const currentYear = inTz(new Date(), await getAppTimeZone()).getFullYear();
  await syncBirthdayEventsForPerson(String(person._id), [
    currentYear,
    currentYear + 1,
  ]);

  const created = await Person.findById(person._id).lean<ILeanPerson>().exec();
  if (!created) throw new Error("Created person could not be reloaded");
  await observeDomainRecordSafely("person", created);
  return serializePerson(created);
}

export async function updatePerson(
  id: string,
  body: Record<string, unknown>,
): Promise<PersonWire | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  await connectDB();

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") update.name = body.name.trim();
  if ("birthday" in body) update.birthday = parseBirthday(body.birthday);
  if (typeof body.placeMet === "string") update.placeMet = body.placeMet;
  if (typeof body.notes === "string") update.notes = body.notes;
  if (Array.isArray(body.photos)) {
    update.photos = parsePhotos(body.photos);
  }
  if (Array.isArray(body.groupIds)) {
    update.groupIds = await prunePersonGroupIds(
      body.groupIds.filter(
        (groupId): groupId is string => typeof groupId === "string",
      ),
    );
  }
  for (const field of ["email", "phone", "website", "address"] as const) {
    if (field in body) {
      const value = body[field];
      update[field] =
        typeof value === "string" && value.trim() ? value.trim() : undefined;
    }
  }
  if ("socials" in body) {
    update.socials = parsePersonSocials(body.socials) ?? [];
  }

  const person = await Person.findByIdAndUpdate(id, update, {
    returnDocument: "after",
    runValidators: true,
  })
    .lean<ILeanPerson>()
    .exec();

  if (!person) return null;

  await replaceRelations(id, body.relations);
  if ("birthday" in body || "name" in body) {
    const year = inTz(new Date(), await getAppTimeZone()).getFullYear();
    await syncBirthdayEventsForPerson(id, [year, year + 1, year + 2], person);
  }

  await observeDomainRecordSafely("person", person);
  return serializePerson(person);
}

export async function deletePerson(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  await connectDB();

  const person = await Person.findByIdAndDelete(id).exec();
  if (!person) return false;

  await Promise.all([
    PersonEdge.deleteMany({ $or: [{ from: id }, { to: id }] }).exec(),
    CalendarEvent.deleteMany({
      kind: "birthday",
      "source.provider": "people",
      "source.personId": new mongoose.Types.ObjectId(id),
    }).exec(),
  ]);

  return true;
}

export async function listPersonGroups(): Promise<PersonGroupWire[]> {
  await connectDB();
  const groups = await PersonGroup.find()
    .sort({ name: 1 })
    .lean<ILeanPersonGroup[]>()
    .exec();
  return groups.map(serializePersonGroup);
}

export async function createPersonGroup(
  body: Record<string, unknown>,
): Promise<PersonGroupWire | null> {
  if (typeof body.name !== "string" || !body.name) return null;

  await connectDB();
  const parentId =
    typeof body.parentId === "string" &&
    mongoose.Types.ObjectId.isValid(body.parentId)
      ? new mongoose.Types.ObjectId(body.parentId)
      : null;

  const group = await PersonGroup.create({
    name: body.name,
    description:
      typeof body.description === "string" ? body.description : undefined,
    color: typeof body.color === "string" ? body.color : undefined,
    parentId,
    autoCreated: false,
  });

  return serializePersonGroup({
    ...group.toObject(),
    _id: group._id.toString(),
    parentId: group.parentId ? String(group.parentId) : null,
  });
}

async function pruneAllPeopleGroupIds() {
  const groups = await PersonGroup.find()
    .select("_id parentId")
    .lean<
      Array<{
        _id: mongoose.Types.ObjectId;
        parentId?: mongoose.Types.ObjectId | null;
      }>
    >()
    .exec();
  const ancestorMap = buildAncestorMap(
    groups.map((candidate) => ({
      _id: String(candidate._id),
      parentId: candidate.parentId ? String(candidate.parentId) : null,
    })),
  );
  const people = await Person.find({
    $expr: { $gt: [{ $size: { $ifNull: ["$groupIds", []] } }, 1] },
  })
    .select("_id groupIds")
    .lean<ILeanPerson[]>()
    .exec();
  const operations = people
    .map((person) => {
      const current = (person.groupIds ?? []).map(String);
      const pruned = pruneRedundantAncestors(current, ancestorMap);
      if (pruned.length === current.length) return null;
      return {
        updateOne: {
          filter: { _id: new mongoose.Types.ObjectId(String(person._id)) },
          update: {
            $set: {
              groupIds: pruned.map(
                (groupId) => new mongoose.Types.ObjectId(groupId),
              ),
            },
          },
        },
      };
    })
    .filter((operation): operation is NonNullable<typeof operation> =>
      Boolean(operation),
    );
  if (operations.length > 0) await Person.bulkWrite(operations);
}

export async function updatePersonGroup(
  id: string,
  body: Record<string, unknown>,
): Promise<PersonGroupWire | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  await connectDB();

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string") update.name = body.name;
  if (typeof body.description === "string")
    update.description = body.description;
  if (typeof body.color === "string") update.color = body.color;
  if ("parentId" in body) {
    if (body.parentId === null || body.parentId === "") {
      update.parentId = null;
    } else if (
      typeof body.parentId === "string" &&
      mongoose.Types.ObjectId.isValid(body.parentId) &&
      body.parentId !== id
    ) {
      update.parentId = new mongoose.Types.ObjectId(body.parentId);
    }
  }

  const group = await PersonGroup.findByIdAndUpdate(id, update, {
    returnDocument: "after",
    runValidators: true,
  })
    .lean<ILeanPersonGroup>()
    .exec();

  if (!group) return null;

  if ("parentId" in update) {
    await pruneAllPeopleGroupIds();
  }

  return serializePersonGroup(group);
}

export async function deletePersonGroup(id: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(id)) return false;
  await connectDB();

  const group = await PersonGroup.findByIdAndDelete(id).exec();
  if (!group) return false;

  const objectId = new mongoose.Types.ObjectId(id);
  await Promise.all([
    Person.updateMany(
      { groupIds: objectId },
      { $pull: { groupIds: objectId } },
    ).exec(),
    PersonGroup.updateMany(
      { parentId: objectId },
      { $set: { parentId: null } },
    ).exec(),
  ]);

  return true;
}
