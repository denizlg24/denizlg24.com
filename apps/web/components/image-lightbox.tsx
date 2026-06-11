"use client";

import { X } from "lucide-react";
import Image from "next/image";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ImageLightboxProps {
  src: string;
  alt: string;
  isOpen: boolean;
  onClose: () => void;
}

export function ImageLightbox({
  src,
  alt,
  isOpen,
  onClose,
}: ImageLightboxProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastPositionRef = useRef({ x: 0, y: 0 });
  const lastDistanceRef = useRef<number | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(
    new Map(),
  );

  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      lastDistanceRef.current = null;
      activePointersRef.current.clear();
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleEscape);
    }
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isOpen, onClose]);

  const getDistance = (
    p1: { x: number; y: number },
    p2: { x: number; y: number },
  ) => {
    return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
  };

  const handlePointerDown = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 1) {
      setIsDragging(true);
      lastPositionRef.current = { x: e.clientX, y: e.clientY };
    }

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: ReactPointerEvent) => {
      e.preventDefault();
      activePointersRef.current.set(e.pointerId, {
        x: e.clientX,
        y: e.clientY,
      });

      const pointers = Array.from(activePointersRef.current.values());

      if (pointers.length === 2) {
        const distance = getDistance(pointers[0], pointers[1]);

        if (lastDistanceRef.current !== null) {
          const delta = distance - lastDistanceRef.current;
          setScale((prev) => Math.min(Math.max(prev + delta * 0.01, 1), 5));
        }

        lastDistanceRef.current = distance;
        return;
      }

      if (isDragging && scale > 1 && pointers.length === 1) {
        const deltaX = e.clientX - lastPositionRef.current.x;
        const deltaY = e.clientY - lastPositionRef.current.y;

        setPosition((prev) => ({
          x: prev.x + deltaX,
          y: prev.y + deltaY,
        }));

        lastPositionRef.current = { x: e.clientX, y: e.clientY };
      }
    },
    [isDragging, scale, getDistance],
  );

  const handlePointerUp = useCallback((e: ReactPointerEvent) => {
    activePointersRef.current.delete(e.pointerId);

    if (activePointersRef.current.size < 2) {
      lastDistanceRef.current = null;
    }

    if (activePointersRef.current.size === 0) {
      setIsDragging(false);
    }

    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const lastTapRef = useRef(0);
  const handleDoubleTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      if (scale > 1) {
        setScale(1);
        setPosition({ x: 0, y: 0 });
      } else {
        setScale(2.5);
      }
    }
    lastTapRef.current = now;
  }, [scale]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.2 : 0.2;
      setScale((prev) => Math.min(Math.max(prev + delta, 1), 5));

      if (scale + delta <= 1) {
        setPosition({ x: 0, y: 0 });
      }
    },
    [scale],
  );

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!isOpen || !mounted) return null;

  const lightboxContent = (
    <div
      className="fixed inset-0 z-9999 bg-black/95 flex items-center justify-center p-4 sm:p-8"
      onClick={(e) => {
        if (e.target === e.currentTarget && scale === 1) onClose();
      }}
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-4 right-4 z-10 text-white hover:bg-white/20"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </Button>

      <div className="absolute top-4 left-4 z-10 text-white/70 text-sm font-mono">
        {Math.round(scale * 100)}%
      </div>

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 text-white/50 text-xs text-center">
        <span className="sm:hidden">Pinch to zoom • Double-tap to reset</span>
        <span className="hidden sm:inline">
          Scroll to zoom • Double-click to reset • Drag to pan
        </span>
      </div>

      <div
        ref={containerRef}
        className={cn(
          "relative flex items-center justify-center overflow-hidden touch-none rounded-lg select-none",
          "w-full h-full sm:max-w-[90vw] sm:max-h-[85vh]",
          scale > 1 ? "cursor-grab" : "cursor-zoom-in",
          isDragging && "cursor-grabbing",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleDoubleTap}
        onWheel={handleWheel}
        onDragStart={(e) => e.preventDefault()}
      >
        <div
          className={cn(
            "relative will-change-transform",
            !isDragging && "transition-transform duration-150",
          )}
          style={{
            transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale})`,
          }}
        >
          <Image
            src={src}
            alt={alt}
            width={1920}
            height={1080}
            className="max-w-full max-h-[calc(100vh-8rem)] sm:max-h-[85vh] w-auto h-auto object-contain select-none pointer-events-none"
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            priority
          />
        </div>
      </div>
    </div>
  );

  return createPortal(lightboxContent, document.body);
}
