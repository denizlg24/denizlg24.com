import {
  CheckSquare,
  FileText,
  FileType,
  Link,
  type LucideIcon,
  StickyNote,
} from "lucide-react";
import type { ComponentType } from "react";
import { MarkdownTemplate } from "./markdown-note";
import { PdfViewerTemplate } from "./pdf-viewer";
import { QuickLinksTemplate } from "./quick-links";
import { StickyNoteTemplate } from "./sticky-note";
import { TodoListTemplate } from "./todo-list";

interface TemplateDefinition {
  name: string;
  icon: LucideIcon;
  defaultSize: { width: number; height: number };
  defaultData: Record<string, unknown>;
  component: ComponentType<TemplateProps>;
}

export interface TemplateProps {
  id: string;
  data: Record<string, unknown>;
  onDataChange: (data: Record<string, unknown>) => void;
  onDelete: () => void;
  width: number;
  height: number;
}

export const templateRegistry: Record<string, TemplateDefinition> = {
  "todo-list": {
    name: "Todo List",
    icon: CheckSquare,
    defaultSize: { width: 280, height: 320 },
    defaultData: {
      title: "Todo List",
      items: [] as { id: string; text: string; completed: boolean }[],
    },
    component: TodoListTemplate,
  },
  "sticky-note": {
    name: "Sticky Note",
    icon: StickyNote,
    defaultSize: { width: 240, height: 240 },
    defaultData: {
      content: "",
      colorIndex: 0,
    },
    component: StickyNoteTemplate,
  },
  "quick-links": {
    name: "Quick Links",
    icon: Link,
    defaultSize: { width: 280, height: 320 },
    defaultData: {
      title: "Quick Links",
      links: [] as { id: string; label: string; url: string }[],
    },
    component: QuickLinksTemplate,
  },
  "markdown-note": {
    name: "Markdown",
    icon: FileText,
    defaultSize: { width: 360, height: 400 },
    defaultData: {
      content: "",
    },
    component: MarkdownTemplate,
  },
  "pdf-viewer": {
    name: "PDF Viewer",
    icon: FileType,
    defaultSize: { width: 500, height: 650 },
    defaultData: {
      pdfUrl: undefined,
      fileName: "",
      currentPage: 1,
      pdfScale: 1,
    },
    component: PdfViewerTemplate,
  },
};
