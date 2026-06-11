import mongoose, { type Document, Schema } from "mongoose";

export interface BirthdayParts {
  month: number;
  day: number;
  year?: number | null;
}

export interface PersonSocial {
  platform: string;
  handle: string;
  url?: string;
}

export interface IPerson extends Document {
  name: string;
  birthday?: BirthdayParts | null;
  placeMet?: string;
  notes: string;
  photos: string[];
  groupIds: mongoose.Types.ObjectId[];
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  socials: PersonSocial[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanPerson {
  _id: string;
  name: string;
  birthday?: BirthdayParts | null;
  placeMet?: string;
  notes: string;
  photos: string[];
  groupIds: string[];
  email?: string;
  phone?: string;
  website?: string;
  address?: string;
  socials: PersonSocial[];
  createdAt: Date;
  updatedAt: Date;
}

const BirthdaySchema = new Schema<BirthdayParts>(
  {
    month: { type: Number, required: true, min: 1, max: 12 },
    day: { type: Number, required: true, min: 1, max: 31 },
    year: { type: Number, default: null },
  },
  { _id: false },
);

const SocialSchema = new Schema<PersonSocial>(
  {
    platform: { type: String, required: true, trim: true },
    handle: { type: String, required: true, trim: true },
    url: { type: String, trim: true },
  },
  { _id: false },
);

const PersonSchema = new Schema<IPerson>(
  {
    name: { type: String, required: true, trim: true, index: true },
    birthday: { type: BirthdaySchema, default: null },
    placeMet: { type: String },
    notes: { type: String, default: "" },
    photos: [{ type: String }],
    groupIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "PersonGroup",
        index: true,
      },
    ],
    email: { type: String, trim: true },
    phone: { type: String, trim: true },
    website: { type: String, trim: true },
    address: { type: String, trim: true },
    socials: { type: [SocialSchema], default: [] },
  },
  { timestamps: true },
);

export const Person: mongoose.Model<IPerson> =
  (mongoose.models.Person as mongoose.Model<IPerson> | undefined) ||
  mongoose.model<IPerson>("Person", PersonSchema);
