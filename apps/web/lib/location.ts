import type {
  LocationBatchInput,
  LocationBatchResult,
  LocationCurrent,
  LocationExplored,
  LocationPoint as LocationPointWire,
  LocationRangeQuery,
  LocationVisit as LocationVisitWire,
} from "@repo/schemas";
import { locationBatchInputSchema } from "@repo/schemas";
import {
  EXPLORED_MAX_ACCURACY_METRES,
  ExploredAccumulator,
} from "@/lib/location-explored";
import { connectDB } from "@/lib/mongodb";
import {
  type ILocationPoint,
  type ILocationVisit,
  LocationPoint,
  LocationVisit,
} from "@/models/Location";

/**
 * A visit whose departure never arrived (the phone died, tracking was turned
 * off) must not read as "still there" forever: once a later fix is this far
 * from it, the owner has demonstrably left.
 */
const LEFT_VISIT_METRES = 250;

function geo(latitude: number, longitude: number) {
  return {
    type: "Point" as const,
    coordinates: [longitude, latitude] as [number, number],
  };
}

export function serializeLocationPoint(
  point: ILocationPoint,
): LocationPointWire {
  return {
    id: point._id,
    installationId: point.installationId,
    recordedAt: point.recordedAt.toISOString(),
    latitude: point.latitude,
    longitude: point.longitude,
    horizontalAccuracy: point.horizontalAccuracy,
    altitude: point.altitude,
    verticalAccuracy: point.verticalAccuracy,
    speed: point.speed,
    course: point.course,
    source: point.source,
  };
}

export function serializeLocationVisit(
  visit: ILocationVisit,
): LocationVisitWire {
  return {
    id: visit._id,
    installationId: visit.installationId,
    arrivedAt: visit.arrivedAt.toISOString(),
    departedAt: visit.departedAt?.toISOString() ?? null,
    latitude: visit.latitude,
    longitude: visit.longitude,
    horizontalAccuracy: visit.horizontalAccuracy,
    places: visit.places ?? [],
    source: visit.source ?? "visit",
    insight: visit.insight
      ? { ...visit.insight, decidedAt: visit.insight.decidedAt.toISOString() }
      : null,
    durationMinutes: visit.departedAt
      ? Math.max(
          0,
          (visit.departedAt.getTime() - visit.arrivedAt.getTime()) / 60_000,
        )
      : null,
  };
}

/**
 * Stores a batch from the phone. Every write is an upsert on the phone's id,
 * so the uploader can resend anything it is unsure about.
 *
 * A visit arrives twice — open, then closed — and the two reports can cross
 * in flight, so the departure is only ever set, never cleared.
 */
export async function ingestLocationBatch(
  input: LocationBatchInput,
): Promise<LocationBatchResult & { arrivals: string[] }> {
  const batch = locationBatchInputSchema.parse(input);
  await connectDB();
  const receivedAt = new Date();

  let points = 0;
  if (batch.points.length) {
    const result = await LocationPoint.bulkWrite(
      batch.points.map((point) => ({
        updateOne: {
          filter: { _id: point.id },
          update: {
            $setOnInsert: {
              installationId: batch.installationId,
              recordedAt: new Date(point.recordedAt),
              latitude: point.latitude,
              longitude: point.longitude,
              location: geo(point.latitude, point.longitude),
              horizontalAccuracy: point.horizontalAccuracy,
              altitude: point.altitude,
              verticalAccuracy: point.verticalAccuracy,
              speed: point.speed,
              course: point.course,
              source: point.source,
              receivedAt,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    points = result.upsertedCount;
  }

  let visits = 0;
  if (batch.visits.length) {
    const result = await LocationVisit.bulkWrite(
      batch.visits.map((visit) => ({
        updateOne: {
          filter: { _id: visit.id },
          update: {
            $set: {
              installationId: batch.installationId,
              arrivedAt: new Date(visit.arrivedAt),
              latitude: visit.latitude,
              longitude: visit.longitude,
              location: geo(visit.latitude, visit.longitude),
              horizontalAccuracy: visit.horizontalAccuracy,
              source: visit.source,
              ...(visit.departedAt
                ? { departedAt: new Date(visit.departedAt) }
                : {}),
              ...(visit.places.length ? { places: visit.places } : {}),
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    visits = result.upsertedCount + result.modifiedCount;
  }

  // Arrivals worth judging: still open and with somewhere named nearby. The
  // judge itself skips any visit that already carries an insight.
  const arrivals = batch.visits
    .filter((visit) => !visit.departedAt && visit.places.length > 0)
    .map((visit) => visit.id);
  return { points, visits, arrivals };
}

function metresBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
) {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) *
      Math.cos(toRad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}

export async function getCurrentLocation(): Promise<LocationCurrent> {
  await connectDB();
  const [point, visit] = await Promise.all([
    LocationPoint.findOne().sort({ recordedAt: -1 }),
    LocationVisit.findOne().sort({ arrivedAt: -1 }),
  ]);
  const left =
    !visit ||
    Boolean(visit.departedAt) ||
    Boolean(
      point &&
        point.recordedAt > visit.arrivedAt &&
        metresBetween(point, visit) > LEFT_VISIT_METRES,
    );
  return {
    point: point ? serializeLocationPoint(point) : null,
    visit: visit && !left ? serializeLocationVisit(visit) : null,
  };
}

/** Oldest first, cut at `limit` with `truncated` set rather than sampled. */
export async function listLocationPoints(query: LocationRangeQuery) {
  await connectDB();
  const rows = await LocationPoint.find({
    recordedAt: { $gte: new Date(query.from), $lte: new Date(query.to) },
  })
    .sort({ recordedAt: 1 })
    .limit(query.limit + 1);
  return {
    points: rows.slice(0, query.limit).map(serializeLocationPoint),
    truncated: rows.length > query.limit,
  };
}

/**
 * Visits that overlap the range: arrived before its end, not gone before its
 * start. An open visit counts only if it began within a day of the range, or
 * one whose departure never arrived would sit in every range after it.
 */
export async function listLocationVisits(query: LocationRangeQuery) {
  await connectDB();
  const from = new Date(query.from);
  const rows = await LocationVisit.find({
    arrivedAt: { $lte: new Date(query.to) },
    $or: [
      { departedAt: { $gte: from } },
      {
        departedAt: { $exists: false },
        arrivedAt: { $gte: new Date(from.getTime() - 86_400_000) },
      },
    ],
  })
    .sort({ arrivedAt: 1 })
    .limit(query.limit + 1);
  return {
    visits: rows.slice(0, query.limit).map(serializeLocationVisit),
    truncated: rows.length > query.limit,
  };
}

let exploredCache: { key: string; value: LocationExplored } | null = null;

/**
 * The whole history swept into explored ground. Rebuilt only when a fix or a
 * stay has landed since the last build: the history is append-only, so the
 * collection sizes (metadata, no scan) and the newest fix are enough to tell.
 */
export async function getExploredGround(): Promise<LocationExplored> {
  await connectDB();
  const accurate = {
    horizontalAccuracy: { $lte: EXPLORED_MAX_ACCURACY_METRES },
  };
  const [points, visits, newest] = await Promise.all([
    LocationPoint.estimatedDocumentCount(),
    LocationVisit.estimatedDocumentCount(),
    LocationPoint.findOne().sort({ recordedAt: -1 }).select("_id").lean(),
  ]);
  const key = `${points}:${visits}:${newest?._id ?? ""}`;
  if (exploredCache?.key === key) return exploredCache.value;

  const accumulator = new ExploredAccumulator();
  const cursor = LocationPoint.find(accurate)
    .sort({ recordedAt: 1 })
    .select("latitude longitude recordedAt")
    .lean()
    .cursor({ batchSize: 2_000 });
  for await (const point of cursor) accumulator.add(point);
  const stays = await LocationVisit.find(accurate)
    .select("latitude longitude arrivedAt")
    .lean();
  for (const stay of stays) {
    accumulator.addStay({
      latitude: stay.latitude,
      longitude: stay.longitude,
      recordedAt: stay.arrivedAt,
    });
  }
  const value = accumulator.finish();
  exploredCache = { key, value };
  return value;
}
