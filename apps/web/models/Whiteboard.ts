import mongoose from "mongoose";

export interface IWhiteboardElement {
  id: string;
  type: "drawing" | "component";
  componentType?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  data: Record<string, unknown>;
  zIndex: number;
}

export interface IWhiteboard {
  _id: unknown;
  name: string;
  elements: IWhiteboardElement[];
  viewState: { x: number; y: number; zoom: number };
  order: number;
  createdAt: Date;
  updatedAt: Date;
  hasBeenCleared: boolean;
}

export interface ILeanWhiteboard {
  _id: string;
  name: string;
  elements: IWhiteboardElement[];
  viewState: { x: number; y: number; zoom: number };
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILeanWhiteboardMeta {
  _id: string;
  name: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const WhiteboardElementSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: { type: String, enum: ["drawing", "component"], required: true },
    componentType: { type: String },
    x: { type: Number, required: true },
    y: { type: Number, required: true },
    width: { type: Number },
    height: { type: Number },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    zIndex: { type: Number, default: 0 },
  },
  { _id: false },
);

export const WhiteboardSchema = new mongoose.Schema<IWhiteboard>(
  {
    name: { type: String, required: true },
    elements: [WhiteboardElementSchema],
    viewState: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      zoom: { type: Number, default: 1 },
    },
    order: { type: Number, default: 0, index: true },
    hasBeenCleared: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const Whiteboard: mongoose.Model<IWhiteboard> =
  mongoose.models.Whiteboard ||
  mongoose.model<IWhiteboard>("Whiteboard", WhiteboardSchema);
