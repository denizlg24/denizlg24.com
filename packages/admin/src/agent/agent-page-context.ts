import type { BackgroundAgentPageContext } from "@repo/schemas";

const MAX_VISIBLE_TEXT = 6_000;

export function captureAgentPageContext(
  options: { includeVisibleText?: boolean; dashboardRoot?: string } = {},
): BackgroundAgentPageContext {
  const fallback = options.dashboardRoot ?? "/dashboard";
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { pathname: fallback };
  }
  const selection = window.getSelection()?.toString().trim().slice(0, 8_000);
  let visibleText: string | undefined;
  if (options.includeVisibleText) {
    const main =
      document.querySelector<HTMLElement>(
        "main [data-agent-page], main [role=main]",
      ) ?? document.querySelector<HTMLElement>("main");
    const clone = main?.cloneNode(true) as HTMLElement | undefined;
    clone
      ?.querySelectorAll("[data-agent-sheet]")
      .forEach((node) => node.remove());
    visibleText = clone?.innerText
      ?.replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_VISIBLE_TEXT);
  }

  return {
    pathname: window.location.pathname || fallback,
    title: document.title || undefined,
    ...(selection ? { selection } : {}),
    ...(visibleText ? { details: { visibleText } } : {}),
  };
}
