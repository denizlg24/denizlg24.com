"use client";

import type {
  IWhiteboard,
  IWhiteboardBackground,
  TextFontFamily,
} from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
import { Page, PageBody } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import {
  DEFAULT_FONT_FAMILY,
  WHITEBOARD_FONT_FAMILIES,
  whiteboardToSvg,
} from "@repo/whiteboard-render";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { PenTool } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DashboardPageHeader } from "@/components/navigation/dashboard-page-header";
import { useUserSettings } from "@/context/user-context";
import type { DrawSettings } from "@/hooks/use-whiteboard-canvas";
import {
  isCreationTool,
  useWhiteboardCanvas,
} from "@/hooks/use-whiteboard-canvas";
import { useWhiteboardHistory } from "@/hooks/use-whiteboard-history";
import { denizApi } from "@/lib/api-wrapper";
import type { IWhiteboardElement } from "@/lib/data-types";
import { isTauri, platformFetch } from "@/lib/platform";
import { saveFile } from "@/lib/platform-fs";
import { extractDirectory } from "@/lib/user-settings";
import { cn } from "@/lib/utils";
import type { WhiteboardTool } from "@/lib/whiteboard-types";
import { WhiteboardBottomBar } from "./whiteboard-bottom-bar";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { WhiteboardLayersPanel } from "./whiteboard-layers-panel";
import { WhiteboardStylePanel } from "./whiteboard-style-panel";
import { WhiteboardHeaderActions, WhiteboardTitle } from "./whiteboard-top-bar";

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function toDataUri(src: string): Promise<string | null> {
  if (src.startsWith("data:")) return src;
  try {
    const res = await platformFetch(src);
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

const CURSOR_MAP: Record<WhiteboardTool, string> = {
  pointer: "cursor-auto",
  hand: "cursor-grab",
  pen: "cursor-[url(/assets/drawing-cursor.png)_1_16,_pointer]",
  highlighter: "cursor-[url(/assets/drawing-cursor.png)_1_16,_pointer]",
  square: "cursor-[url(/assets/shape-cursor.png)_7_7,_pointer]",
  rectangle: "cursor-[url(/assets/shape-cursor.png)_7_7,_pointer]",
  circle: "cursor-[url(/assets/shape-cursor.png)_7_7,_pointer]",
  arrow: "cursor-[url(/assets/shape-cursor.png)_7_7,_pointer]",
  line: "cursor-[url(/assets/shape-cursor.png)_7_7,_pointer]",
  text: "cursor-[url(/assets/text-cursor.png)_3_11,_pointer]",
  eraser: "cursor-[url(/assets/eraser-cursor.png)_0_16,_pointer]",
  bucket: "cursor-copy",
};

const TOOL_KEYS: Record<string, WhiteboardTool> = {
  v: "pointer",
  p: "pen",
  h: "highlighter",
  e: "eraser",
  t: "text",
  r: "rectangle",
  o: "circle",
  a: "arrow",
  l: "line",
  b: "bucket",
};

/** Focus inside any of these owns the keyboard; board shortcuts stand down. */
const KEYBOARD_OWNER_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="menu"], [role="listbox"], [role="slider"], [role="dialog"], [role="combobox"]';

const SHAPE_TOOLS: ReadonlySet<WhiteboardTool> = new Set([
  "rectangle",
  "square",
  "circle",
  "line",
  "arrow",
]);

interface WhiteboardEditorProps {
  id?: string;
  onBack?: () => void;
  todayMode?: boolean;
}

export function WhiteboardEditor({
  id,
  onBack,
  todayMode,
}: WhiteboardEditorProps) {
  const { settings, loading: loadingSettings, setSettings } = useUserSettings();

  const API = useMemo(
    () => (loadingSettings ? null : new denizApi()),
    [loadingSettings],
  );

  const [loading, setLoading] = useState(true);
  const [whiteboard, setWhiteboard] = useState<IWhiteboard | null>(null);

  const [selectedTool, setSelectedTool] = useState<WhiteboardTool>("pen");
  const [color, setColor] = useState("#18181b");
  const [penThickness, setPenThickness] = useState(4);
  const [highlighterThickness, setHighlighterThickness] = useState(12);
  const [shapeFill, setShapeFill] = useState("none");
  const [fontSize, setFontSize] = useState(24);
  const [fontWeight, setFontWeight] = useState(400);
  const [fontFamily, setFontFamily] =
    useState<TextFontFamily>(DEFAULT_FONT_FAMILY);
  const [align, setAlign] = useState<"left" | "center" | "right">("left");
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [background, setBackground] = useState<IWhiteboardBackground>({
    color: "#ffffff",
    pattern: "dots",
  });
  const [layersOpen, setLayersOpen] = useState(false);
  const [spaceActive, setSpaceActive] = useState(false);

  const history = useWhiteboardHistory([]);
  const canvas = useWhiteboardCanvas(history);

  const backgroundRef = useRef(background);
  useEffect(() => {
    backgroundRef.current = background;
  }, [background]);

  useEffect(() => {
    history.setBackgroundApplier(setBackground);
  }, [history.setBackgroundApplier]);

  const applyBackground = useCallback(
    (next: IWhiteboardBackground) => {
      history.pushAction({
        type: "update",
        before: [],
        after: [],
        background: { before: backgroundRef.current, after: next },
      });
      setBackground(next);
    },
    [history.pushAction],
  );

  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const initialSnapshot = useRef<string>("");

  const addRecent = useCallback((c: string) => {
    if (c === "none" || c === "") return;
    setRecentColors((prev) => [c, ...prev.filter((x) => x !== c)].slice(0, 8));
  }, []);

  useEffect(() => {
    const current = JSON.stringify({ elements: history.elements, background });
    setHasChanges(
      !!initialSnapshot.current && current !== initialSnapshot.current,
    );
  }, [history.elements, background]);

  const endpoint = todayMode ? "whiteboard/today" : `whiteboard/${id}`;

  const fetchWhiteboard = useCallback(async () => {
    if (!API || (!todayMode && !id)) return;
    setLoading(true);
    try {
      const result = await API.GET<{ whiteboard: IWhiteboard }>({ endpoint });
      if ("code" in result) {
        console.error(result);
        setLoading(false);
        return;
      }
      setWhiteboard(result.whiteboard);
      history.replaceAll(result.whiteboard.elements);
      canvas.initializeView(result.whiteboard.viewState);
      const bg = result.whiteboard.background ?? {
        color: "#ffffff",
        pattern: "dots",
      };
      setBackground(bg);
      initialSnapshot.current = JSON.stringify({
        elements: result.whiteboard.elements,
        background: bg,
      });
      setLoading(false);
    } catch (_error) {
      setLoading(false);
    }
  }, [API, id, todayMode, endpoint, history, canvas]);

  useEffect(() => {
    if (!API || (!todayMode && !id) || !loading) return;
    fetchWhiteboard();
  }, [API, id, todayMode, loading, fetchWhiteboard]);

  const handleSave = useCallback(async () => {
    if (!API || !whiteboard) return;
    setIsSaving(true);
    try {
      const result = await API.PUT<{ whiteboard: IWhiteboard }>({
        endpoint,
        body: {
          elements: history.elements,
          viewState: canvas.viewState,
          background,
        },
      });
      if (!("code" in result)) {
        initialSnapshot.current = JSON.stringify({
          elements: history.elements,
          background,
        });
        setHasChanges(false);
      }
    } catch (_error) {}
    setIsSaving(false);
  }, [
    API,
    whiteboard,
    endpoint,
    history.elements,
    canvas.viewState,
    background,
  ]);

  const handleDiscard = useCallback(() => {
    if (!whiteboard) return;
    history.replaceAll(whiteboard.elements);
    canvas.initializeView(whiteboard.viewState);
    canvas.setSelectedElementIds(new Set());
    setBackground(
      whiteboard.background ?? { color: "#ffffff", pattern: "dots" },
    );
    setHasChanges(false);
  }, [whiteboard, history, canvas]);

  const handleRename = useCallback(
    async (newName: string) => {
      if (!API || !whiteboard) return;
      try {
        const result = await API.PUT<{ whiteboard: IWhiteboard }>({
          endpoint,
          body: { name: newName },
        });
        if (!("code" in result)) {
          setWhiteboard((prev) => (prev ? { ...prev, name: newName } : prev));
        }
      } catch (_error) {}
    },
    [API, whiteboard, endpoint],
  );

  const handleClear = useCallback(async () => {
    if (!API || !whiteboard) return;
    setIsSaving(true);
    try {
      const result = await API.DELETE<{ whiteboard: IWhiteboard }>({
        endpoint,
      });
      if (!("code" in result)) {
        history.replaceAll([]);
        canvas.initializeView({ x: 0, y: 0, zoom: 1 });
        canvas.setSelectedElementIds(new Set());
        initialSnapshot.current = JSON.stringify({ elements: [], background });
        setHasChanges(false);
        setWhiteboard((prev) =>
          prev
            ? { ...prev, elements: [], viewState: { x: 0, y: 0, zoom: 1 } }
            : prev,
        );
      }
    } catch (_error) {}
    setIsSaving(false);
  }, [API, whiteboard, endpoint, history, canvas, background]);

  const handleExportPNG = useCallback(async () => {
    const targetElements =
      canvas.selectedElementIds.size > 0
        ? history.elements.filter((el) => canvas.selectedElementIds.has(el.id))
        : history.elements;
    if (targetElements.length === 0) return;

    const measureCanvas = document.createElement("canvas");
    const mctx = measureCanvas.getContext("2d");
    const measureText = (
      text: string,
      size: number,
      family: TextFontFamily,
      weight: number,
    ) => {
      if (!mctx) return text.length * size * 0.5;
      mctx.font = `${weight} ${size}px ${WHITEBOARD_FONT_FAMILIES[family].css}`;
      return mctx.measureText(text).width;
    };

    const imageHrefs: Record<string, string> = {};
    for (const el of targetElements) {
      if (whiteboardElementKind(el) !== "image") continue;
      const src = (el.data as { src?: string }).src;
      if (!src || imageHrefs[src]) continue;
      const uri = await toDataUri(src);
      if (uri) imageHrefs[src] = uri;
    }

    const result = whiteboardToSvg(targetElements, {
      background,
      measureText,
      imageHrefs,
      unresolvedImages: "placeholder",
    });

    const scale = 2;
    const canvasWidth = Math.ceil(result.width * scale);
    const canvasHeight = Math.ceil(result.height * scale);
    const blob = new Blob([result.svg], {
      type: "image/svg+xml;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);

    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load SVG for export"));
        img.src = url;
      });

      const offscreen = document.createElement("canvas");
      offscreen.width = canvasWidth;
      offscreen.height = canvasHeight;
      const ctx = offscreen.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);

      const pngBlob = await new Promise<Blob | null>((resolve) =>
        offscreen.toBlob(resolve, "image/png"),
      );
      if (!pngBlob) return;

      const fileName = `${whiteboard?.name ?? "whiteboard"}.png`;
      const bytes = new Uint8Array(await pngBlob.arrayBuffer());

      if (!isTauri()) {
        await saveFile(fileName, bytes, { mimeType: "image/png" });
        return;
      }

      const defaultDir = settings.defaultWhiteboardDownloadPath;
      const defaultPath = defaultDir ? `${defaultDir}${fileName}` : fileName;
      const path = await save({
        filters: [{ name: "PNG Image", extensions: ["png"] }],
        defaultPath,
      });
      if (!path) return;
      const dir = extractDirectory(path);
      if (dir.trim()) setSettings({ defaultWhiteboardDownloadPath: dir });
      await writeFile(path, bytes);
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [
    whiteboard,
    history.elements,
    canvas.selectedElementIds,
    background,
    settings.defaultWhiteboardDownloadPath,
    setSettings,
  ]);

  const isTypingTarget = useCallback(
    (target: EventTarget | null) =>
      canvas.textBox !== null ||
      (target instanceof Element &&
        target.closest(KEYBOARD_OWNER_SELECTOR) !== null),
    [canvas.textBox],
  );

  const { setSelectedElementIds } = canvas;
  const selectTool = useCallback(
    (tool: WhiteboardTool) => {
      if (isCreationTool(tool)) setSelectedElementIds(new Set());
      setSelectedTool(tool);
    },
    [setSelectedElementIds],
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " && !isTypingTarget(e.target)) {
        if (!e.repeat) {
          setSpaceActive(true);
          canvas.setSpacePan(true);
        }
        e.preventDefault();
        return;
      }
      if (isTypingTarget(e.target)) return;

      const mod = e.ctrlKey || e.metaKey;

      if (e.key === "Delete" || e.key === "Backspace") {
        if (canvas.selectedElementIds.size === 0) return;
        e.preventDefault();
        canvas.deleteSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        history.undo();
        return;
      }
      if (
        (mod && e.shiftKey && e.key.toLowerCase() === "z") ||
        (mod && e.key === "y")
      ) {
        e.preventDefault();
        history.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        canvas.selectAll();
        setSelectedTool("pointer");
        return;
      }
      if (mod && e.key.toLowerCase() === "c") {
        e.preventDefault();
        canvas.copySelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "x") {
        e.preventDefault();
        canvas.cutSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "v") {
        if (canvas.hasClipboard()) {
          e.preventDefault();
          canvas.pasteElements();
          setSelectedTool("pointer");
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        canvas.duplicateSelected();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
      if (e.key === "[") {
        e.preventDefault();
        canvas.reorderZ(mod ? "back" : "backward");
        return;
      }
      if (e.key === "]") {
        e.preventDefault();
        canvas.reorderZ(mod ? "front" : "forward");
        return;
      }
      if (e.key.startsWith("Arrow")) {
        if (canvas.selectedElementIds.size === 0) return;
        e.preventDefault();
        const d = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0;
        const dy = e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0;
        canvas.nudgeSelected(dx, dy);
        return;
      }
      /* Text editing handles its own Escape (commit and select). Here each
         press undoes one layer: the running gesture, the selection, then
         the tool. */
      if (e.key === "Escape") {
        if (canvas.cancelGesture()) return;
        if (canvas.selectedElementIds.size > 0) {
          canvas.setSelectedElementIds(new Set());
          return;
        }
        setSelectedTool("pointer");
        return;
      }
      if (!mod && !e.altKey) {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) selectTool(tool);
      }
    };

    const releaseSpace = () => {
      setSpaceActive(false);
      canvas.setSpacePan(false);
    };
    const upHandler = (e: KeyboardEvent) => {
      if (e.key === " ") releaseSpace();
    };

    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", upHandler);
    window.addEventListener("blur", releaseSpace);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", upHandler);
      window.removeEventListener("blur", releaseSpace);
    };
  }, [canvas, history, handleSave, isTypingTarget, selectTool]);

  useEffect(() => {
    const handler = async (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            canvas.pasteImage(await readFileAsDataURL(file));
            setSelectedTool("pointer");
          }
          return;
        }
      }
    };
    window.addEventListener("paste", handler);
    return () => window.removeEventListener("paste", handler);
  }, [canvas, isTypingTarget]);

  const drawSettings: DrawSettings = useMemo(
    () => ({
      color,
      thickness: penThickness,
      highlighterThickness,
      fill: shapeFill,
      fontSize,
      fontWeight,
      fontFamily,
      align,
      onSetBackground: (c) =>
        applyBackground({ ...backgroundRef.current, color: c }),
    }),
    [
      color,
      penThickness,
      highlighterThickness,
      shapeFill,
      fontSize,
      fontWeight,
      fontFamily,
      align,
      applyBackground,
    ],
  );

  const wrappedPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      canvas.onPointerDown(e, selectedTool, drawSettings);
      if (selectedTool === "bucket" && e.button === 0 && !spaceActive)
        setSelectedTool("pointer");
    },
    [canvas, selectedTool, drawSettings, spaceActive],
  );

  /* tldraw's model: a shape hands over to select with itself selected, a pen
     stroke keeps the pen. A press that created nothing keeps the tool. */
  const wrappedPointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const created = canvas.onPointerUp(e, selectedTool);
      if (created && SHAPE_TOOLS.has(selectedTool)) setSelectedTool("pointer");
    },
    [canvas, selectedTool],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (selectedTool !== "pointer" && selectedTool !== "text") return;
      if (canvas.onDoubleClick(e)) setSelectedTool("pointer");
    },
    [canvas, selectedTool],
  );

  const handleColorChange = useCallback(
    (c: string) => {
      setColor(c);
      addRecent(c);
    },
    [addRecent],
  );

  const handleImageUpload = useCallback(
    async (file: File) => {
      canvas.addImage(await readFileAsDataURL(file));
      setSelectedTool("pointer");
    },
    [canvas],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      for (const file of e.dataTransfer.files) {
        if (file.type.startsWith("image/")) {
          canvas.addImage(await readFileAsDataURL(file));
          setSelectedTool("pointer");
          return;
        }
      }
    },
    [canvas],
  );

  const crumbs = onBack
    ? [{ label: "Whiteboards", onClick: onBack }]
    : undefined;

  if (loading || !whiteboard) {
    return (
      <Page>
        <DashboardPageHeader
          icon={<PenTool />}
          crumbs={crumbs}
          title={<Skeleton className="h-3.5 w-32" />}
        />
        <PageBody bleed>
          <Skeleton className="absolute bottom-3 left-1/2 h-9 w-96 max-w-[calc(100%-1.5rem)] -translate-x-1/2 rounded-lg" />
        </PageBody>
      </Page>
    );
  }

  const selectedElements: IWhiteboardElement[] = history.elements.filter((el) =>
    canvas.selectedElementIds.has(el.id),
  );
  const cursorClass = spaceActive ? "cursor-grab" : CURSOR_MAP[selectedTool];

  return (
    <Page>
      <DashboardPageHeader
        icon={<PenTool />}
        crumbs={crumbs}
        title={
          <WhiteboardTitle
            name={whiteboard.name}
            onRename={todayMode ? undefined : handleRename}
          />
        }
      >
        <WhiteboardHeaderActions
          hasChanges={hasChanges}
          isSaving={isSaving}
          viewState={canvas.viewState}
          selectedCount={canvas.selectedElementIds.size}
          background={background}
          onBackgroundChange={applyBackground}
          onSave={handleSave}
          onDiscard={handleDiscard}
          onDeleteSelected={canvas.deleteSelected}
          onResetView={() => canvas.setViewState({ x: 0, y: 0, zoom: 1 })}
          onZoomIn={() =>
            canvas.setViewState((p) => ({
              ...p,
              zoom: Math.min(5, p.zoom * 1.25),
            }))
          }
          onZoomOut={() =>
            canvas.setViewState((p) => ({
              ...p,
              zoom: Math.max(0.1, p.zoom / 1.25),
            }))
          }
          onExportPNG={handleExportPNG}
          onClear={todayMode ? handleClear : undefined}
        />
      </DashboardPageHeader>
      <PageBody bleed>
        <div
          className={cn(
            "whiteboard-container absolute inset-0 overflow-clip",
            cursorClass,
          )}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
        >
          <WhiteboardCanvas
            elements={history.elements}
            background={background}
            viewState={canvas.viewState}
            selectedTool={selectedTool}
            selectedElementIds={canvas.selectedElementIds}
            selectionRect={canvas.selectionRect}
            activeDrawing={canvas.activeDrawing}
            textBox={canvas.textBox}
            textDraft={canvas.textDraft}
            onPointerDown={wrappedPointerDown}
            onPointerMove={(e) => canvas.onPointerMove(e, selectedTool)}
            onPointerUp={wrappedPointerUp}
            onPointerCancel={canvas.cancelGesture}
            onWheel={canvas.onWheel}
            onDoubleClick={handleDoubleClick}
            onTextCommit={(t, w, h, select) => {
              canvas.commitText(t, w, h, select);
              setSelectedTool("pointer");
            }}
            onStartResize={canvas.startResize}
            onStartRotate={(e) => {
              const svg = (e.target as SVGElement).ownerSVGElement;
              if (!svg) return;
              const rect = svg.getBoundingClientRect();
              const wx =
                (e.clientX - rect.left - canvas.viewState.x) /
                canvas.viewState.zoom;
              const wy =
                (e.clientY - rect.top - canvas.viewState.y) /
                canvas.viewState.zoom;
              canvas.startRotate(wx, wy);
            }}
            onComponentDataChange={canvas.updateComponentData}
            onComponentDelete={canvas.deleteElement}
          />

          {selectedTool === "pointer" &&
            selectedElements.length > 0 &&
            !canvas.textBox && (
              <WhiteboardStylePanel
                selected={selectedElements}
                onUpdateStyle={canvas.updateSelectedStyle}
                onReorder={canvas.reorderZ}
                recents={recentColors}
                onPickColor={addRecent}
              />
            )}

          {layersOpen && (
            <WhiteboardLayersPanel
              elements={history.elements}
              selectedIds={canvas.selectedElementIds}
              onSelect={(id, additive) => {
                canvas.setSelectedElementIds((prev) => {
                  const next = additive ? new Set(prev) : new Set<string>();
                  if (additive && next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
                setSelectedTool("pointer");
              }}
              onMoveZ={canvas.moveElementZ}
              onDelete={canvas.deleteElement}
              onClose={() => setLayersOpen(false)}
            />
          )}

          <WhiteboardBottomBar
            selectedTool={selectedTool}
            penThickness={penThickness}
            highlighterThickness={highlighterThickness}
            selectedColor={color}
            recentColors={recentColors}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            layersOpen={layersOpen}
            onToolChange={selectTool}
            onPenThicknessChange={setPenThickness}
            onHighlighterThicknessChange={setHighlighterThickness}
            onColorChange={handleColorChange}
            onUndo={history.undo}
            onRedo={history.redo}
            onToggleLayers={() => setLayersOpen((v) => !v)}
            onAddComponent={(componentType, defaultSize, defaultData) => {
              canvas.addComponent(componentType, defaultSize, defaultData);
              setSelectedTool("pointer");
            }}
            onImageUpload={handleImageUpload}
          />
        </div>
      </PageBody>
    </Page>
  );
}
