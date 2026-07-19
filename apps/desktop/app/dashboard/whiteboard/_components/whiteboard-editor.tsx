"use client";

import type {
  IWhiteboard,
  IWhiteboardBackground,
  TextFontFamily,
} from "@repo/schemas";
import { whiteboardElementKind } from "@repo/schemas";
import { Spinner } from "@repo/ui/spinner";
import {
  DEFAULT_FONT_FAMILY,
  WHITEBOARD_FONT_FAMILIES,
  whiteboardToSvg,
} from "@repo/whiteboard-render";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useUserSettings } from "@/context/user-context";
import type { DrawSettings } from "@/hooks/use-whiteboard-canvas";
import { useWhiteboardCanvas } from "@/hooks/use-whiteboard-canvas";
import { useWhiteboardHistory } from "@/hooks/use-whiteboard-history";
import { denizApi } from "@/lib/api-wrapper";
import type { IWhiteboardElement } from "@/lib/data-types";
import { isTauri, platformFetch } from "@/lib/platform";
import { saveFile } from "@/lib/platform-fs";
import { extractDirectory } from "@/lib/user-settings";
import { cn } from "@/lib/utils";
import { hitTest } from "@/lib/whiteboard-geometry";
import type { WhiteboardTool } from "@/lib/whiteboard-types";
import { WhiteboardBottomBar } from "./whiteboard-bottom-bar";
import { WhiteboardCanvas } from "./whiteboard-canvas";
import { WhiteboardLayersPanel } from "./whiteboard-layers-panel";
import { WhiteboardStylePanel } from "./whiteboard-style-panel";
import { WhiteboardTopBar } from "./whiteboard-top-bar";

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

  const API = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

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
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      canvas.textBox !== null,
    [canvas.textBox],
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
      if (e.key === "Escape") {
        canvas.setSelectedElementIds(new Set());
        canvas.cancelText();
        return;
      }
      if (!mod) {
        const tool = TOOL_KEYS[e.key.toLowerCase()];
        if (tool) setSelectedTool(tool);
      }
    };

    const upHandler = (e: KeyboardEvent) => {
      if (e.key === " ") {
        setSpaceActive(false);
        canvas.setSpacePan(false);
      }
    };

    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", upHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", upHandler);
    };
  }, [canvas, history, handleSave, isTypingTarget]);

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

  const SHAPE_TOOLS: WhiteboardTool[] = useMemo(
    () => ["rectangle", "square", "circle", "line", "arrow"],
    [],
  );

  const wrappedPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      canvas.onPointerDown(e, selectedTool, drawSettings);
      if (selectedTool === "bucket") setSelectedTool("pointer");
    },
    [canvas, selectedTool, drawSettings],
  );

  const wrappedPointerUp = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      canvas.onPointerUp(e, selectedTool);
      if (SHAPE_TOOLS.includes(selectedTool)) setSelectedTool("pointer");
    },
    [canvas, selectedTool, SHAPE_TOOLS],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const wx =
        (e.clientX - rect.left - canvas.viewState.x) / canvas.viewState.zoom;
      const wy =
        (e.clientY - rect.top - canvas.viewState.y) / canvas.viewState.zoom;
      const sorted = [...history.elements].sort((a, b) => b.zIndex - a.zIndex);
      for (const el of sorted) {
        if (whiteboardElementKind(el) === "text" && hitTest(el, wx, wy, 4)) {
          canvas.beginEditText(el.id);
          setSelectedTool("pointer");
          return;
        }
      }
    },
    [canvas, history.elements],
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

  if (loading || !whiteboard) {
    return (
      <div className="w-dvw h-full overflow-clip relative flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const selectedElements: IWhiteboardElement[] = history.elements.filter((el) =>
    canvas.selectedElementIds.has(el.id),
  );
  const cursorClass = spaceActive ? "cursor-grab" : CURSOR_MAP[selectedTool];

  return (
    <div
      className={cn(
        "whiteboard-container w-dvw h-full overflow-clip relative",
        cursorClass,
      )}
      onDrop={handleDrop}
      onDragOver={(e) => e.preventDefault()}
    >
      <SidebarTrigger className="absolute left-2 top-2 z-20 size-7 bg-background/80 md:hidden" />
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
        onWheel={canvas.onWheel}
        onDoubleClick={handleDoubleClick}
        onTextCommit={(t, w, h) => {
          canvas.commitText(t, w, h);
          setSelectedTool("pointer");
        }}
        onTextCancel={() => {
          canvas.cancelText();
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
            (e.clientY - rect.top - canvas.viewState.y) / canvas.viewState.zoom;
          canvas.startRotate(wx, wy);
        }}
        onComponentDataChange={canvas.updateComponentData}
        onComponentDelete={canvas.deleteElement}
      />

      <WhiteboardTopBar
        boardName={whiteboard.name}
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
        onRename={todayMode ? undefined : handleRename}
        onBack={onBack}
        onClear={todayMode ? handleClear : undefined}
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
          onSelect={(id, additive) =>
            canvas.setSelectedElementIds((prev) => {
              const next = additive ? new Set(prev) : new Set<string>();
              if (additive && next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            })
          }
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
        onToolChange={setSelectedTool}
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
  );
}
