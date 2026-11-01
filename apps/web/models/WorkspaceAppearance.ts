import type {
  ModuleCustomization,
  ThemeBackground,
  ThemeColors,
  ThemeEffect,
  ThemeFont,
  ThemeFontImport,
  ThemeOrnament,
  ThemeScheduleEntry,
  UiDensity,
} from "@repo/schemas";
import mongoose from "mongoose";

/** The appearance singleton (`_id: "appearance"`): active theme, schedule, sidebar dressing. */
export interface IWorkspaceAppearance {
  _id: string;
  themeId: string;
  schedule: ThemeScheduleEntry[];
  textScale: number;
  density: UiDensity;
  modules: Record<string, ModuleCustomization>;
  sectionOrder: string[];
  moduleOrder: string[];
  moduleThemes: Record<string, string>;
  updatedAt: Date;
}

const workspaceAppearanceSchema = new mongoose.Schema<IWorkspaceAppearance>(
  {
    _id: { type: String, required: true },
    themeId: { type: String, required: true },
    schedule: { type: mongoose.Schema.Types.Mixed, default: [] },
    textScale: { type: Number, default: 1 },
    density: { type: String, default: "default" },
    modules: { type: mongoose.Schema.Types.Mixed, default: {} },
    sectionOrder: { type: [String], default: [] },
    moduleOrder: { type: [String], default: [] },
    moduleThemes: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: { createdAt: false, updatedAt: true },
    minimize: false,
    versionKey: false,
  },
);

export const WorkspaceAppearanceModel: mongoose.Model<IWorkspaceAppearance> =
  mongoose.models.WorkspaceAppearance ||
  mongoose.model<IWorkspaceAppearance>(
    "WorkspaceAppearance",
    workspaceAppearanceSchema,
  );

/** A theme the owner or an agent made; built-ins live in `@repo/schemas`. */
export interface IWorkspaceTheme {
  _id: mongoose.Types.ObjectId;
  name: string;
  description: string;
  scheme: "light" | "dark";
  colors: ThemeColors;
  radius: number;
  fonts: { body: ThemeFont; heading: ThemeFont };
  effect: ThemeEffect;
  ornament: ThemeOrnament;
  background: ThemeBackground | null;
  fontImport: ThemeFontImport | null;
  css: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceThemeSchema = new mongoose.Schema<IWorkspaceTheme>(
  {
    name: { type: String, required: true },
    description: { type: String, default: "" },
    scheme: { type: String, default: "light" },
    colors: { type: mongoose.Schema.Types.Mixed, required: true },
    radius: { type: Number, default: 0.625 },
    fonts: { type: mongoose.Schema.Types.Mixed, required: true },
    effect: { type: mongoose.Schema.Types.Mixed, required: true },
    ornament: { type: mongoose.Schema.Types.Mixed, default: {} },
    background: { type: mongoose.Schema.Types.Mixed, default: null },
    fontImport: { type: mongoose.Schema.Types.Mixed, default: null },
    css: { type: String, default: "" },
    createdBy: { type: String, required: true },
  },
  { timestamps: true, minimize: false, versionKey: false },
);

export const WorkspaceThemeModel: mongoose.Model<IWorkspaceTheme> =
  mongoose.models.WorkspaceTheme ||
  mongoose.model<IWorkspaceTheme>("WorkspaceTheme", workspaceThemeSchema);
