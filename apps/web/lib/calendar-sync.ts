import { addYears, eachYearOfInterval } from "date-fns";
import mongoose from "mongoose";
import {
  anchorDateFromCalendarDate,
  calendarDateFromDate,
  serializeCalendarEvent,
} from "@/lib/calendar-events";
import { connectDB } from "@/lib/mongodb";
import { getAppTimeZone, inTz } from "@/lib/timezone";
import { CalendarEvent } from "@/models/CalendarEvent";
import {
  CalendarSettings,
  type ILeanCalendarSettings,
} from "@/models/CalendarSettings";
import { type BirthdayParts, type ILeanPerson, Person } from "@/models/Person";

const NAGER_BASE_URL = "https://date.nager.at/api/v3";
const ensurePromises = new Map<string, Promise<void>>();

interface NagerCountry {
  countryCode: string;
  name: string;
}

interface NagerHoliday {
  date: string;
  localName?: string;
  name: string;
  countryCode: string;
  global: boolean;
  counties?: string[] | null;
  types?: string[];
}

export async function fetchSupportedHolidayCountries() {
  const response = await fetch(`${NAGER_BASE_URL}/AvailableCountries`, {
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!response.ok) throw new Error("Failed to fetch countries");
  return (await response.json()) as NagerCountry[];
}

export async function syncHolidayEventsForYears(
  countryCode: string,
  years: number[],
) {
  await connectDB();
  const normalizedCountry = countryCode.trim().toUpperCase();
  if (!normalizedCountry) return [];

  const results = await Promise.all(
    [...new Set(years)].map((year) =>
      syncHolidayEventsForYear(normalizedCountry, year),
    ),
  );

  return results.flat();
}

export async function syncBirthdayEventsForYears(years: number[]) {
  await connectDB();
  const people = await Person.find({
    "birthday.month": { $gte: 1, $lte: 12 },
    "birthday.day": { $gte: 1, $lte: 31 },
  })
    .lean<ILeanPerson[]>()
    .exec();

  const results = await Promise.all(
    people.map((person) =>
      syncBirthdayEventsForPerson(String(person._id), years, person),
    ),
  );

  return results.flat();
}

export async function syncBirthdayEventsForPerson(
  personId: string,
  years: number[],
  providedPerson?: ILeanPerson,
) {
  await connectDB();
  const person =
    providedPerson ??
    (await Person.findById(personId).lean<ILeanPerson>().exec());
  if (!person?.birthday) return [];

  const events = [];
  for (const year of [...new Set(years)]) {
    const calendarDate = birthdayCalendarDate(person.birthday, year);
    if (!calendarDate) continue;

    const providerKey = birthdayProviderKey(personId, year);
    const event = await upsertGeneratedEvent({
      providerKey,
      kind: "birthday",
      calendarDate,
      title: `${person.name}'s birthday`,
      source: {
        provider: "people",
        providerKey,
        personId: new mongoose.Types.ObjectId(personId),
        generatedYear: year,
        isCustomized: false,
        isSuppressed: false,
        metadata: {
          birthday: person.birthday,
        },
      },
    });
    if (event) events.push(event);
  }

  return events;
}

export async function ensureGeneratedCalendarEventsForRange(
  start: Date,
  end: Date,
) {
  const key = touchedYears(start, end, await getAppTimeZone()).join(",");
  const existing = ensurePromises.get(key);
  if (existing) return existing;

  const promise = ensureGeneratedCalendarEventsForRangeInternal(
    start,
    end,
  ).finally(() => {
    ensurePromises.delete(key);
  });
  ensurePromises.set(key, promise);
  return promise;
}

async function ensureGeneratedCalendarEventsForRangeInternal(
  start: Date,
  end: Date,
) {
  await connectDB();
  const years = touchedYears(start, end, await getAppTimeZone());
  const settings = await CalendarSettings.findByIdAndUpdate(
    "singleton",
    { $setOnInsert: { holidayCountryCode: null } },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  )
    .lean<ILeanCalendarSettings>()
    .exec();

  const generatedBirthdayYears = settings.generatedBirthdayYears ?? [];
  const generatedHolidaySyncs = settings.generatedHolidaySyncs ?? [];
  const birthdayYears = years.filter(
    (year) => !generatedBirthdayYears.includes(year),
  );
  const holidayCountryCode = settings.holidayCountryCode?.trim().toUpperCase();
  const holidayYears = holidayCountryCode
    ? years.filter(
        (year) =>
          !generatedHolidaySyncs.some(
            (sync) =>
              sync.countryCode === holidayCountryCode && sync.year === year,
          ),
      )
    : [];

  await Promise.all([
    holidayCountryCode && holidayYears.length > 0
      ? syncHolidayEventsForYears(holidayCountryCode, holidayYears).then(() =>
          markGeneratedHolidayYears(holidayCountryCode, holidayYears),
        )
      : Promise.resolve(),
    birthdayYears.length > 0
      ? syncBirthdayEventsForYears(birthdayYears).then(() =>
          markGeneratedBirthdayYears(birthdayYears),
        )
      : Promise.resolve(),
  ]);
}

export async function ensureGeneratedCalendarEventsForCurrentWindow() {
  const now = new Date();
  await ensureGeneratedCalendarEventsForRange(now, addYears(now, 1));
}

async function syncHolidayEventsForYear(countryCode: string, year: number) {
  const response = await fetch(
    `${NAGER_BASE_URL}/PublicHolidays/${year}/${countryCode}`,
  );
  if (!response.ok) throw new Error("Failed to fetch public holidays");

  const holidays = ((await response.json()) as NagerHoliday[]).filter(
    (holiday) => holiday.global === true,
  );
  const events = [];

  for (const holiday of holidays) {
    const providerKey = holidayProviderKey(countryCode, year, holiday.date);
    const event = await upsertGeneratedEvent({
      providerKey,
      kind: "holiday",
      calendarDate: holiday.date,
      title: holiday.localName || holiday.name,
      source: {
        provider: "nager-date",
        providerKey,
        countryCode,
        generatedYear: year,
        isCustomized: false,
        isSuppressed: false,
        metadata: {
          englishName: holiday.name,
          types: holiday.types ?? [],
        },
      },
    });
    if (event) events.push(event);
  }

  return events;
}

async function markGeneratedBirthdayYears(years: number[]) {
  if (years.length === 0) return;

  await CalendarSettings.findByIdAndUpdate("singleton", {
    $addToSet: { generatedBirthdayYears: { $each: years } },
  }).exec();
}

async function markGeneratedHolidayYears(countryCode: string, years: number[]) {
  if (years.length === 0) return;

  await CalendarSettings.findByIdAndUpdate("singleton", {
    $addToSet: {
      generatedHolidaySyncs: {
        $each: years.map((year) => ({ countryCode, year })),
      },
    },
  }).exec();
}

async function upsertGeneratedEvent({
  providerKey,
  kind,
  calendarDate,
  title,
  source,
}: {
  providerKey: string;
  kind: "holiday" | "birthday";
  calendarDate: string;
  title: string;
  source: NonNullable<Parameters<typeof CalendarEvent.create>[0]["source"]>;
}) {
  const existing = await CalendarEvent.findOne({
    "source.providerKey": providerKey,
  })
    .lean()
    .exec();

  if (existing?.source?.isCustomized) {
    return serializeCalendarEvent(existing);
  }

  const date = anchorDateFromCalendarDate(calendarDate);
  const update = {
    title,
    date,
    calendarDate,
    isAllDay: true,
    kind,
    status: "scheduled",
    notifyBySlack: false,
    isNotificationSent: false,
    notifyBeforeMinutes: 15,
    links: [],
    source: {
      ...source,
      isSuppressed: existing?.source?.isSuppressed ?? false,
    },
  };

  const event = await CalendarEvent.findOneAndUpdate(
    { "source.providerKey": providerKey },
    { $set: update },
    { returnDocument: "after", upsert: true, setDefaultsOnInsert: true },
  )
    .lean()
    .exec();

  return event ? serializeCalendarEvent(event) : null;
}

function touchedYears(start: Date, end: Date, timeZone: string) {
  const tzStart = inTz(start, timeZone);
  const tzEnd = inTz(end, timeZone);
  const years = eachYearOfInterval({ start: tzStart, end: tzEnd }).map((date) =>
    date.getFullYear(),
  );
  years.push(tzStart.getFullYear(), tzEnd.getFullYear());
  return [...new Set(years)];
}

function birthdayCalendarDate(birthday: BirthdayParts, year: number) {
  const date = `${year}-${String(birthday.month).padStart(2, "0")}-${String(
    birthday.day,
  ).padStart(2, "0")}`;
  return calendarDateFromDate(anchorDateFromCalendarDate(date)) === date
    ? date
    : null;
}

function holidayProviderKey(countryCode: string, year: number, date: string) {
  return `holiday:${countryCode}:${year}:${date}`;
}

function birthdayProviderKey(personId: string, year: number) {
  return `birthday:${personId}:${year}`;
}
