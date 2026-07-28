import type { BackgroundAgentPageContext } from "@/lib/data-types";

const MAX_VISIBLE_TEXT = 6_000;

export function captureAgentPageContext(): BackgroundAgentPageContext {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { pathname: "/dashboard" };
  }
  const selection = window.getSelection()?.toString().trim().slice(0, 8_000);
  const main =
    document.querySelector<HTMLElement>(
      "main [data-agent-page], main [role=main]",
    ) ?? document.querySelector<HTMLElement>("main");
  const clone = main?.cloneNode(true) as HTMLElement | undefined;
  clone
    ?.querySelectorAll("[data-agent-sheet]")
    .forEach((node) => node.remove());
  const visibleText = clone?.innerText
    ?.replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_VISIBLE_TEXT);

  return {
    pathname: window.location.pathname,
    title: document.title || undefined,
    ...(selection ? { selection } : {}),
    ...(visibleText ? { details: { visibleText } } : {}),
  };
}
