"use client";

import { useEffect, useRef, useState } from "react";

const KEYBOARD_OPEN_THRESHOLD_PX = 120;
const CLOSE_DEBOUNCE_MS = 120;

type VirtualKeyboardLike = EventTarget & {
  boundingRect: DOMRectReadOnly;
  overlaysContent: boolean;
};

type NavigatorWithVirtualKeyboard = Navigator & {
  virtualKeyboard?: VirtualKeyboardLike;
};

export type KeyboardInset = {
  inset: number;
  isOpen: boolean;
};

/**
 * Tracks the software keyboard without reading browser globals during render.
 *
 * The value is also published on the root element as `--kb-inset` and
 * `data-keyboard="open|closed"`, so fixed chrome can react without subscribing
 * every component to viewport animation events.
 */
export function useKeyboardInset(): KeyboardInset {
  const [keyboard, setKeyboard] = useState<KeyboardInset>({
    inset: 0,
    isOpen: false,
  });
  const keyboardOpenRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard)
      .virtualKeyboard;
    let animationFrame = 0;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    if (virtualKeyboard) {
      virtualKeyboard.overlaysContent = true;
    }

    const publish = (rawInset: number) => {
      const inset = Math.max(0, Math.round(rawInset));
      const isOpen = inset >= KEYBOARD_OPEN_THRESHOLD_PX;

      if (closeTimer) {
        clearTimeout(closeTimer);
        closeTimer = undefined;
      }

      const commit = () => {
        cancelAnimationFrame(animationFrame);
        animationFrame = requestAnimationFrame(() => {
          const value = isOpen ? inset : 0;
          root.style.setProperty(
            "--kb-inset",
            virtualKeyboard
              ? `max(env(keyboard-inset-height, 0px), ${value}px)`
              : `${value}px`,
          );
          root.dataset.keyboard = isOpen ? "open" : "closed";
          keyboardOpenRef.current = isOpen;
          setKeyboard((current) =>
            current.inset === value && current.isOpen === isOpen
              ? current
              : { inset: value, isOpen },
          );
        });
      };

      if (!isOpen && keyboardOpenRef.current) {
        closeTimer = setTimeout(commit, CLOSE_DEBOUNCE_MS);
      } else {
        commit();
      }
    };

    const measureVisualViewport = () => {
      if (!viewport) {
        publish(0);
        return;
      }
      publish(window.innerHeight - (viewport.height + viewport.offsetTop));
    };

    const measureVirtualKeyboard = () => {
      publish(virtualKeyboard?.boundingRect.height ?? 0);
    };

    root.dataset.keyboard = "closed";
    root.style.setProperty("--kb-inset", "0px");
    viewport?.addEventListener("resize", measureVisualViewport);
    viewport?.addEventListener("scroll", measureVisualViewport, {
      passive: true,
    });
    virtualKeyboard?.addEventListener("geometrychange", measureVirtualKeyboard);
    measureVisualViewport();

    return () => {
      cancelAnimationFrame(animationFrame);
      if (closeTimer) clearTimeout(closeTimer);
      viewport?.removeEventListener("resize", measureVisualViewport);
      viewport?.removeEventListener("scroll", measureVisualViewport);
      virtualKeyboard?.removeEventListener(
        "geometrychange",
        measureVirtualKeyboard,
      );
      root.style.removeProperty("--kb-inset");
      delete root.dataset.keyboard;
    };
  }, []);

  return keyboard;
}
