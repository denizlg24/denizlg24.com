"use client";

import { useCallback, useRef, useState } from "react";
import type { IWhiteboard } from "@/lib/data-types";
import type { ViewState } from "@/lib/whiteboard-types";
import { WhiteboardCanvas } from "../../whiteboard/_components/whiteboard-canvas";

const EMPTY_SET = new Set<string>();
const noop = () => {};

interface WhiteboardViewerProps {
  whiteboard: IWhiteboard;
}

export function WhiteboardViewer({ whiteboard }: WhiteboardViewerProps) {
  const [viewState, setViewState] = useState<ViewState>(
    whiteboard.viewState ?? { x: 0, y: 0, zoom: 1 },
  );

  const isPanning = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  const onPointerDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    isPanning.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setViewState((prev) => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy,
    }));
  }, []);

  const onPointerUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const onWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = e.currentTarget.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = -e.deltaY * 0.001;
      setViewState((prev) => {
        const newZoom = Math.max(0.1, Math.min(5, prev.zoom * (1 + delta)));
        const scale = newZoom / prev.zoom;
        return {
          x: mx - (mx - prev.x) * scale,
          y: my - (my - prev.y) * scale,
          zoom: newZoom,
        };
      });
    } else {
      setViewState((prev) => ({
        ...prev,
        x: prev.x - e.deltaX,
        y: prev.y - e.deltaY,
      }));
    }
  }, []);

  return (
    <div className="w-full h-full cursor-grab active:cursor-grabbing">
      <WhiteboardCanvas
        elements={whiteboard.elements}
        viewState={viewState}
        selectedTool="hand"
        selectedElementIds={EMPTY_SET}
        selectionRect={null}
        activeDrawing={null}
        textBox={null}
        selectedColor="#000000"
        selectedThickness={4}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onTextCommit={noop}
        onTextCancel={noop}
        onDeleteSelected={noop}
        onStartResize={noop}
        onComponentDataChange={noop}
        onComponentDelete={noop}
      />
    </div>
  );
}
