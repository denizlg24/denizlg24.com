import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { syncBirthdayEventsForPerson } from "@/lib/calendar-sync";
import { connectDB } from "@/lib/mongodb";
import {
  canonicalPersonPair,
  parsePersonSocials,
  prunePersonGroupIds,
  serializePerson,
  serializePersonEdge,
  serializePersonGroup,
} from "@/lib/people-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { type BirthdayParts, type ILeanPerson, Person } from "@/models/Person";
import { type ILeanPersonEdge, PersonEdge } from "@/models/PersonEdge";
import { type ILeanPersonGroup, PersonGroup } from "@/models/PersonGroup";

function parseBirthday(value: unknown): BirthdayParts | null | undefined {
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

function parsePhotos(value: unknown) {
  return Array.isArray(value)
    ? value.filter((photo): photo is string => typeof photo === "string")
    : [];
}

async function replaceRelations(personId: string, relations: unknown) {
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

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    const [people, groups, edges] = await Promise.all([
      Person.find().sort({ updatedAt: -1 }).lean<ILeanPerson[]>().exec(),
      PersonGroup.find().sort({ name: 1 }).lean<ILeanPersonGroup[]>().exec(),
      PersonEdge.find().lean<ILeanPersonEdge[]>().exec(),
    ]);

    return NextResponse.json({
      people: people.map(serializePerson),
      groups: groups.map(serializePersonGroup),
      edges: edges.map(serializePersonEdge),
      stats: {
        total: people.length,
        groups: groups.length,
        edges: edges.length,
      },
    });
  } catch (error) {
    console.error("Error fetching people:", error);
    return NextResponse.json(
      { error: "Failed to fetch people" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    if (typeof body.name !== "string" || !body.name.trim()) {
      return NextResponse.json({ error: "name required" }, { status: 400 });
    }

    await connectDB();
    const birthday = parseBirthday(body.birthday);
    const groupIds = await prunePersonGroupIds(
      Array.isArray(body.groupIds) ? body.groupIds : [],
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
      website:
        typeof body.website === "string" ? body.website.trim() : undefined,
      address:
        typeof body.address === "string" ? body.address.trim() : undefined,
      socials: parsePersonSocials(body.socials) ?? [],
    });

    await replaceRelations(String(person._id), body.relations);
    await syncBirthdayEventsForPerson(String(person._id), [
      new Date().getFullYear(),
      new Date().getFullYear() + 1,
    ]);

    const [createdPerson, groups, edges] = await Promise.all([
      Person.findById(person._id).lean<ILeanPerson>().exec(),
      PersonGroup.find().sort({ name: 1 }).lean<ILeanPersonGroup[]>().exec(),
      PersonEdge.find({
        $or: [{ from: person._id }, { to: person._id }],
      })
        .lean<ILeanPersonEdge[]>()
        .exec(),
    ]);

    if (!createdPerson) throw new Error("Created person could not be reloaded");

    return NextResponse.json(
      {
        person: serializePerson(createdPerson),
        groups: groups.map(serializePersonGroup),
        edges: edges.map(serializePersonEdge),
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating person:", error);
    return NextResponse.json(
      { error: (error as Error).message || "Failed to create person" },
      { status: 500 },
    );
  }
}
