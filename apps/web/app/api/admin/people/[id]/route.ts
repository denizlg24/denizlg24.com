import mongoose from "mongoose";
import { type NextRequest, NextResponse } from "next/server";
import { syncBirthdayEventsForPerson } from "@/lib/calendar-sync";
import { connectDB } from "@/lib/mongodb";
import {
  canonicalPersonPair,
  parsePersonSocials,
  prunePersonGroupIds,
  serializePerson,
} from "@/lib/people-route-utils";
import { requireAdmin } from "@/lib/require-admin";
import { CalendarEvent } from "@/models/CalendarEvent";
import { type BirthdayParts, type ILeanPerson, Person } from "@/models/Person";
import { PersonEdge } from "@/models/PersonEdge";

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

  if (operations.length > 0) await PersonEdge.bulkWrite(operations);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  await connectDB();
  const { id } = await params;
  const person = await Person.findById(id).lean<ILeanPerson>().exec();
  if (!person)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ person: serializePerson(person) });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const body = await request.json();
    await connectDB();

    const update: Record<string, unknown> = {};
    if (typeof body.name === "string") update.name = body.name.trim();
    if ("birthday" in body) update.birthday = parseBirthday(body.birthday);
    if (typeof body.placeMet === "string") update.placeMet = body.placeMet;
    if (typeof body.notes === "string") update.notes = body.notes;
    if (Array.isArray(body.photos)) {
      update.photos = body.photos.filter(
        (photo: unknown): photo is string => typeof photo === "string",
      );
    }
    if (Array.isArray(body.groupIds)) {
      update.groupIds = await prunePersonGroupIds(body.groupIds);
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
      new: true,
      runValidators: true,
    })
      .lean<ILeanPerson>()
      .exec();

    if (!person)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await replaceRelations(id, body.relations);
    if ("birthday" in body || "name" in body) {
      const year = new Date().getFullYear();
      await syncBirthdayEventsForPerson(id, [year, year + 1, year + 2], person);
    }

    return NextResponse.json({ person: serializePerson(person) });
  } catch (error) {
    console.error("Error updating person:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    await connectDB();

    const person = await Person.findByIdAndDelete(id).exec();
    if (!person)
      return NextResponse.json({ error: "Not found" }, { status: 404 });

    await Promise.all([
      PersonEdge.deleteMany({ $or: [{ from: id }, { to: id }] }).exec(),
      CalendarEvent.deleteMany({
        kind: "birthday",
        "source.provider": "people",
        "source.personId": new mongoose.Types.ObjectId(id),
      }).exec(),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting person:", error);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
