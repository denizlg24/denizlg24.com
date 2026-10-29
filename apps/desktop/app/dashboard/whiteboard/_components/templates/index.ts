import {
  CheckSquare,
  FileText,
  FileType,
  Link,
  type LucideIcon,
  StickyNote,
} from "lucide-react";
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { MarkdownTemplate } from "./markdown-note";
import { QuickLinksTemplate } from "./quick-links";
import { StickyNoteTemplate } from "./sticky-note";
import { TodoListTemplate } from "./todo-list";

// react-pdf 11 loads pdfjs's viewer module at import time, and that module
// reads `window` on evaluation — so any page reaching it statically fails to
// prerender. Loading the template on the client only keeps it out of the build.
const PdfViewerTemplate = dynamic(
  () => import("./pdf-viewer").then((m) => m.PdfViewerTemplate),
  { ssr: false },
);

interface TemplateDefinition {
  name: string;
  icon: LucideIcon;
  defaultSize: { width: number; height: number };
  defaultData: Record<string, unknown>;
  component: ComponentType<TemplateProps>;
}

export interface ComponentSize {
  width?: number;
  height?: number;
}

export interface TemplateProps {
  id: string;
  data: Record<string, unknown>;
  /** A component that grows with its content passes the size it now needs.
   *  It rides along with the data so one edit stays one undo step. */
  onDataChange: (data: Record<string, unknown>, size?: ComponentSize) => void;
  onDelete: () => void;
  width: number;
  height: number;
}

export const templateRegistry: Record<string, TemplateDefinition> = {
  "todo-list": {
    name: "Checklist",
    icon: CheckSquare,
    defaultSize: { width: 420, height: 220 },
    defaultData: {
      title: "",
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
