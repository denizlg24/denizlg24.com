import { z } from "zod";

export const drawingBrushSchema = z.enum(["pen", "highlighter"]);
export type DrawingBrush = z.infer<typeof drawingBrushSchema>;

export const drawingDataSchema = z.object({
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(2),
  color: z.string(),
  thickness: z.number().positive(),
  brush: drawingBrushSchema.optional(),
});
export type IDrawingData = z.infer<typeof drawingDataSchema>;

export const shapeTypeSchema = z.enum([
  "square",
  "rectangle",
  "circle",
  "arrow",
  "line",
]);
export type ShapeType = z.infer<typeof shapeTypeSchema>;

export const shapeDataSchema = z.object({
  shapeType: shapeTypeSchema,
  color: z.string(),
  thickness: z.number().positive(),
  fill: z.string().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
});
export type IShapeData = z.infer<typeof shapeDataSchema>;

export const textFontFamilySchema = z.enum([
  "sans",
  "serif",
  "mono",
  "handwriting",
]);
export type TextFontFamily = z.infer<typeof textFontFamilySchema>;

export const textDataSchema = z.object({
  text: z.string(),
  color: z.string(),
  fontSize: z.number().positive(),
  fontWeight: z.number().min(100).max(900).optional(),
  fontFamily: textFontFamilySchema.optional(),
  align: z.enum(["left", "center", "right"]).optional(),
});
export type ITextData = z.infer<typeof textDataSchema>;

export const imageDataSchema = z.object({
  src: z.string(),
});
export type IImageData = z.infer<typeof imageDataSchema>;

export const todoListDataSchema = z.object({
  title: z.string(),
  items: z.array(
    z.object({ id: z.string(), text: z.string(), completed: z.boolean() }),
  ),
});
export type ITodoListData = z.infer<typeof todoListDataSchema>;

export const stickyNoteDataSchema = z.object({
  content: z.string(),
  colorIndex: z.number().int().min(0),
});
export type IStickyNoteData = z.infer<typeof stickyNoteDataSchema>;

export const quickLinksDataSchema = z.object({
  title: z.string(),
  links: z.array(
    z.object({ id: z.string(), label: z.string(), url: z.string() }),
  ),
});
export type IQuickLinksData = z.infer<typeof quickLinksDataSchema>;

export const markdownNoteDataSchema = z.object({
  content: z.string(),
});
export type IMarkdownNoteData = z.infer<typeof markdownNoteDataSchema>;

export const pdfViewerDataSchema = z.object({
  pdfUrl: z.string().optional(),
  fileName: z.string().optional(),
  currentPage: z.number().optional(),
  pdfScale: z.number().optional(),
});
export type IPdfViewerData = z.infer<typeof pdfViewerDataSchema>;

export const componentTypeSchema = z.enum([
  "todo-list",
  "sticky-note",
  "quick-links",
  "markdown-note",
  "pdf-viewer",
]);
export type WhiteboardComponentType = z.infer<typeof componentTypeSchema>;

export const componentDataSchemas: Record<
  WhiteboardComponentType,
  z.ZodType<Record<string, unknown>>
> = {
  "todo-list": todoListDataSchema,
  "sticky-note": stickyNoteDataSchema,
  "quick-links": quickLinksDataSchema,
  "markdown-note": markdownNoteDataSchema,
  "pdf-viewer": pdfViewerDataSchema,
};

export const whiteboardElementSchema = z.object({
  id: z.string(),
  type: z.enum(["drawing", "component"]),
  componentType: z.string().optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional(),
  height: z.number().optional(),
  rotation: z.number().optional(),
  data: z.record(z.string(), z.unknown()),
  zIndex: z.number(),
});
export type IWhiteboardElement = z.infer<typeof whiteboardElementSchema>;

export type WhiteboardElementKind =
  | "pen"
  | "shape"
  | "text"
  | "image"
  | "component"
  | "unknown";

export function whiteboardElementKind(
  element: IWhiteboardElement,
): WhiteboardElementKind {
  if (element.type === "component") return "component";
  const data = element.data;
  if (data.points !== undefined) return "pen";
  if (data.shapeType !== undefined) return "shape";
  if (data.text !== undefined) return "text";
  if (data.src !== undefined) return "image";
  return "unknown";
}

const drawingKindDataSchemas: Record<string, z.ZodType> = {
  pen: drawingDataSchema,
  shape: shapeDataSchema,
  text: textDataSchema,
  image: imageDataSchema,
};

export function validateWhiteboardElement(
  element: IWhiteboardElement,
): { ok: true } | { ok: false; error: string } {
  const kind = whiteboardElementKind(element);
  if (kind === "unknown") {
    return {
      ok: false,
      error:
        "Element data must match one of: pen drawing (points), shape (shapeType), text (text), image (src)",
    };
  }
  let schema: z.ZodType;
  if (kind === "component") {
    const componentType = componentTypeSchema.safeParse(element.componentType);
    if (!componentType.success) {
      return {
        ok: false,
        error: `Unknown componentType "${element.componentType}". Valid types: ${componentTypeSchema.options.join(", ")}`,
      };
    }
    schema = componentDataSchemas[componentType.data];
  } else {
    schema = drawingKindDataSchemas[kind] ?? drawingDataSchema;
  }
  const result = schema.safeParse(element.data);
  if (!result.success) {
    return { ok: false, error: z.prettifyError(result.error) };
  }
  return { ok: true };
}

export const whiteboardBackgroundSchema = z.object({
  color: z.string(),
  pattern: z.enum(["none", "dots", "grid", "lines"]).optional(),
});
export type IWhiteboardBackground = z.infer<typeof whiteboardBackgroundSchema>;

export const whiteboardSchema = z.object({
  _id: z.string(),
  name: z.string(),
  elements: z.array(whiteboardElementSchema),
  viewState: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
  background: whiteboardBackgroundSchema.optional(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IWhiteboard = z.infer<typeof whiteboardSchema>;

export const whiteboardMetaSchema = z.object({
  _id: z.string(),
  name: z.string(),
  order: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type IWhiteboardMeta = z.infer<typeof whiteboardMetaSchema>;
