import type {
  IDrawingData,
  IImageData,
  IShapeData,
  ITextData,
  IWhiteboardElement,
} from "@repo/schemas";

export type {
  IDrawingData,
  IImageData,
  IShapeData,
  ITextData,
} from "@repo/schemas";

// Legacy aliases kept to minimize churn across desktop call sites.
export type DrawingData = IDrawingData;
export type ShapeData = IShapeData;
export type TextData = ITextData;
export type ImageData = IImageData;

export type WhiteboardTool =
  | "pointer"
  | "pen"
  | "highlighter"
  | "eraser"
  | "text"
  | "rectangle"
  | "square"
  | "circle"
  | "arrow"
  | "line"
  | "bucket"
  | "hand";

export interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

export type HistoryActionType = "add" | "remove" | "update" | "batch";

export interface HistoryEntry {
  type: HistoryActionType;
  before: IWhiteboardElement[];
  after: IWhiteboardElement[];
  background?: {
    before: import("@repo/schemas").IWhiteboardBackground;
    after: import("@repo/schemas").IWhiteboardBackground;
  };
}

export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextBoxState {
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  autoSize: boolean;
  maxWidth: number;
  editingId: string | null;
  color: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: import("@repo/schemas").TextFontFamily;
  align: "left" | "center" | "right";
  initialText: string;
}

export interface TextDraft {
  x: number;
  y: number;
  width: number;
  height: number;
}
