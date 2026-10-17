import type {
  LocationInsight,
  LocationPlace,
  LocationPointSource,
  LocationVisitSource,
} from "@repo/schemas";
import mongoose from "mongoose";

/**
 * The owner's location history, kept indefinitely.
 *
 * Not a time-series collection: those refuse unique indexes, and `_id` is the
 * id the phone minted, which is what makes a retried batch land once. A
 * GeoJSON point beside the flat coordinates is what the 2dsphere index needs
 * for "what was near here" queries.
 */

interface GeoPoint {
  type: "Point";
  /** [longitude, latitude] — GeoJSON order. */
  coordinates: [number, number];
}

const geoPointSchema = new mongoose.Schema<GeoPoint>(
  {
    type: { type: String, enum: ["Point"], required: true },
    coordinates: { type: [Number], required: true },
  },
  { _id: false },
);

export interface ILocationPoint {
  _id: string;
  installationId: string;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  location: GeoPoint;
  horizontalAccuracy: number;
  altitude?: number;
  verticalAccuracy?: number;
  speed?: number;
  course?: number;
  source: LocationPointSource;
  receivedAt: Date;
}

const locationPointSchema = new mongoose.Schema<ILocationPoint>(
  {
    _id: { type: String, required: true },
    installationId: { type: String, required: true },
    recordedAt: { type: Date, required: true },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    location: { type: geoPointSchema, required: true },
    horizontalAccuracy: { type: Number, required: true },
    altitude: Number,
    verticalAccuracy: Number,
    speed: Number,
    course: Number,
    source: { type: String, enum: ["significant", "live"], required: true },
    receivedAt: { type: Date, required: true },
  },
  { versionKey: false },
);

locationPointSchema.index({ recordedAt: -1 });
locationPointSchema.index({ location: "2dsphere" });

const placeSchema = new mongoose.Schema<LocationPlace>(
  {
    name: { type: String, required: true },
    category: { type: String, default: null },
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    distanceMetres: { type: Number, required: true },
  },
  { _id: false },
);

type StoredInsight = Omit<LocationInsight, "decidedAt"> & { decidedAt: Date };

const insightSchema = new mongoose.Schema<StoredInsight>(
  {
    place: { type: String, required: true },
    notified: { type: Boolean, required: true },
    title: { type: String, default: null },
    body: { type: String, default: null },
    reason: { type: String, required: true },
    decidedAt: { type: Date, required: true },
  },
  { _id: false },
);

export interface ILocationVisit {
  _id: string;
  installationId: string;
  arrivedAt: Date;
  /** Unset while the visit is open. */
  departedAt?: Date;
  latitude: number;
  longitude: number;
  location: GeoPoint;
  horizontalAccuracy: number;
  places: LocationPlace[];
  /** Absent on rows from before geofences and stop detection: those were all `visit`. */
  source?: LocationVisitSource;
  /** Set once the arrival has been judged; never judged twice. */
  insight?: StoredInsight;
  createdAt: Date;
  updatedAt: Date;
}

const locationVisitSchema = new mongoose.Schema<ILocationVisit>(
  {
    _id: { type: String, required: true },
    installationId: { type: String, required: true },
    arrivedAt: { type: Date, required: true },
    departedAt: Date,
    latitude: { type: Number, required: true },
    longitude: { type: Number, required: true },
    location: { type: geoPointSchema, required: true },
    horizontalAccuracy: { type: Number, required: true },
    places: { type: [placeSchema], default: [] },
    source: { type: String, enum: ["visit", "geofence", "stop"] },
    insight: insightSchema,
  },
  { timestamps: true, versionKey: false },
);

locationVisitSchema.index({ arrivedAt: -1 });
locationVisitSchema.index({ location: "2dsphere" });

export const LocationPoint: mongoose.Model<ILocationPoint> =
  mongoose.models.LocationPoint ||
  mongoose.model<ILocationPoint>("LocationPoint", locationPointSchema);

export const LocationVisit: mongoose.Model<ILocationVisit> =
  mongoose.models.LocationVisit ||
  mongoose.model<ILocationVisit>("LocationVisit", locationVisitSchema);
