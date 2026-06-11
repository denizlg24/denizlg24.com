import type { IWhiteboardElement } from "./data-types";

export type WhiteboardTool =
  | "pen"
  | "square"
  | "rectangle"
  | "circle"
  | "arrow"
  | "text"
  | "eraser"
  | "hand"
  | "pointer"
  | "select";

export interface DrawingData {
  points: { x: number; y: number }[];
  color: string;
  thickness: number;
}

export interface ShapeData {
  shapeType: "square" | "rectangle" | "circle" | "arrow";
  color: string;
  thickness: number;

  x2?: number;
  y2?: number;
}

export interface TextData {
  text: string;
  color: string;
  fontSize: number;
}

export interface ImageData {
  src: string;
}

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
}

export type ResizeHandle =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WhiteboardCanvasProps {
  elements: IWhiteboardElement[];
  viewState: ViewState;
  selectedTool: WhiteboardTool;
  selectedColor: string;
  selectedThickness: number;
  selectedElementIds: Set<string>;
  selectionRect: SelectionRect | null;
  activeDrawing: IWhiteboardElement | null;
  onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => void;
  onPointerUp: (e: React.PointerEvent<SVGSVGElement>) => void;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
}
