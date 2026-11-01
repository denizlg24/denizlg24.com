"use client";

import {
  normalizePageStyle,
  PAGE_COVER_GRADIENTS,
  PAGE_WIDTHS,
  type PageStyle,
  type PageWidth,
  THEME_FONTS,
  type WorkspacePage,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@repo/ui/dropdown-menu";
import { Input } from "@repo/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { cn } from "@repo/ui/utils";
import { ImageIcon, MoveVertical, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAppearanceStore } from "./appearance/store";
import { FONT_STACKS } from "./appearance/theme-css";
import { useWorkspaceStore } from "./store";

export const COVER_GRADIENTS: Record<
  (typeof PAGE_COVER_GRADIENTS)[number],
  string
> = {
  dawn: "linear-gradient(120deg, #fbd3c4 0%, #f6e7b4 50%, #c9e4de 100%)",
  dusk: "linear-gradient(120deg, #2b2d5b 0%, #8a4f7d 55%, #f0a37a 100%)",
  forest: "linear-gradient(120deg, #1f3d2b 0%, #4f7a4a 55%, #a7c49a 100%)",
  ocean: "linear-gradient(120deg, #0f3057 0%, #00587a 50%, #79c2d0 100%)",
  ember: "linear-gradient(120deg, #3a0d0d 0%, #b3261e 55%, #f2b134 100%)",
  frost: "linear-gradient(120deg, #e6eefb 0%, #c9dcf2 50%, #f7fbff 100%)",
  festive:
    "repeating-linear-gradient(135deg, #b3261e 0 18px, #f7f3ea 18px 36px, #1f6f43 36px 54px, #f7f3ea 54px 72px)",
  meadow: "linear-gradient(120deg, #f0f7d4 0%, #b9dd8f 50%, #6fa85d 100%)",
  plum: "linear-gradient(120deg, #2e1a3b 0%, #6d3b7a 50%, #d39bc4 100%)",
  sand: "linear-gradient(120deg, #f5ead7 0%, #e3cba4 50%, #c49a6c 100%)",
};

export function coverStyle(cover: string, position = 50): React.CSSProperties {
  if (cover.startsWith("gradient:")) {
    const name = cover.slice(
      "gradient:".length,
    ) as keyof typeof COVER_GRADIENTS;
    return { background: COVER_GRADIENTS[name] ?? COVER_GRADIENTS.dawn };
  }
  if (cover.startsWith("color:")) return { background: cover.slice(6) };
  return {
    backgroundImage: `url(${JSON.stringify(cover)})`,
    backgroundSize: "cover",
    backgroundPosition: `center ${position}%`,
  };
}

export function effectiveWidth(page: WorkspacePage): PageWidth {
  return page.style?.width ?? (page.fullWidth ? "full" : "wide");
}

export const WIDTH_CLASS: Record<PageWidth, string> = {
  narrow: "max-w-3xl",
  default: "max-w-5xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};

export function pageFontStyle(
  style: PageStyle | undefined,
): React.CSSProperties {
  return {
    ...(style?.font ? { fontFamily: FONT_STACKS[style.font] } : {}),
    ...(style?.smallText ? { zoom: 0.9 } : {}),
  };
}

function useSetStyle(page: WorkspacePage) {
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  return (patch: Partial<PageStyle>) =>
    updatePage(page.id, {
      style: normalizePageStyle({ ...page.style, ...patch }),
      ...(patch.width ? { fullWidth: patch.width === "full" } : {}),
    });
}

/** Cover picker: gradients, a colour, or an image URL. */
export function CoverPicker({
  page,
  children,
}: {
  page: WorkspacePage;
  children: React.ReactNode;
}) {
  const setStyle = useSetStyle(page);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-3 p-3">
        <div className="grid grid-cols-5 gap-1.5">
          {PAGE_COVER_GRADIENTS.map((name) => (
            <button
              key={name}
              type="button"
              title={name}
              aria-label={name}
              onClick={() => {
                setStyle({ cover: `gradient:${name}` });
                setOpen(false);
              }}
              className="h-9 rounded-md ring-offset-1 ring-offset-background hover:ring-2 hover:ring-ring"
              style={{ background: COVER_GRADIENTS[name] }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            aria-label="Colour"
            onChange={(event) =>
              setStyle({ cover: `color:${event.target.value}` })
            }
            className="size-8 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
          />
          <Input
            aria-label="Image URL"
            placeholder="https:// image"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && /^https:\/\//.test(url.trim())) {
                setStyle({ cover: url.trim(), coverPosition: 50 });
                setUrl("");
                setOpen(false);
              }
            }}
            className="h-8 text-xs"
          />
        </div>
        {page.style?.cover ? (
          <Button
            variant="ghost"
            size="xs"
            className="w-fit text-muted-foreground"
            onClick={() => {
              setStyle({ cover: undefined, coverPosition: undefined });
              setOpen(false);
            }}
          >
            <X /> Remove cover
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

/** The banner at the top of a page; image covers drag vertically to reposition. */
export function PageCover({
  page,
  editable,
}: {
  page: WorkspacePage;
  editable: boolean;
}) {
  const setStyle = useSetStyle(page);
  const [dragging, setDragging] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cover = page.style?.cover;
  if (!cover) return null;
  const isImage = /^https:\/\//.test(cover);
  const position = dragging ?? page.style?.coverPosition ?? 50;

  const startDrag = (event: React.PointerEvent) => {
    event.preventDefault();
    const start = event.clientY;
    const initial = position;
    const height = ref.current?.getBoundingClientRect().height ?? 200;
    let latest = initial;
    const move = (e: PointerEvent) => {
      latest = Math.max(
        0,
        Math.min(
          100,
          Math.round(initial - ((e.clientY - start) / height) * 100),
        ),
      );
      setDragging(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setDragging(null);
      setStyle({ coverPosition: latest });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      ref={ref}
      className="group/cover relative h-[30vh] max-h-72 min-h-36 w-full shrink-0"
      style={coverStyle(cover, position)}
    >
      {editable ? (
        <div className="absolute right-4 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/cover:opacity-100">
          <CoverPicker page={page}>
            <Button variant="secondary" size="xs">
              <ImageIcon /> Change
            </Button>
          </CoverPicker>
          {isImage ? (
            <Button
              variant="secondary"
              size="xs"
              onPointerDown={startDrag}
              className={cn(dragging !== null && "cursor-grabbing")}
            >
              <MoveVertical /> Reposition
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Wears the page's own theme while it is open. */
export function usePageTheme(page: WorkspacePage | undefined) {
  const setPageTheme = useAppearanceStore((s) => s.setPageTheme);
  const themeId = page?.style?.themeId ?? null;
  useEffect(() => {
    setPageTheme(themeId);
    return () => setPageTheme(null);
  }, [themeId, setPageTheme]);
}

/** Layout, typography and theme entries for the page options menu. */
export function PageStyleMenuItems({ page }: { page: WorkspacePage }) {
  const setStyle = useSetStyle(page);
  const themes = useAppearanceStore((s) => s.themes);
  const style = page.style ?? {};
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Width</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={effectiveWidth(page)}
            onValueChange={(width) => setStyle({ width: width as PageWidth })}
          >
            {PAGE_WIDTHS.map((width) => (
              <DropdownMenuRadioItem key={width} value={width}>
                {width}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Font</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={style.font ?? "theme"}
            onValueChange={(font) =>
              setStyle({
                font:
                  font === "theme"
                    ? undefined
                    : (font as (typeof THEME_FONTS)[number]),
              })
            }
          >
            <DropdownMenuRadioItem value="theme">theme</DropdownMenuRadioItem>
            {THEME_FONTS.map((font) => (
              <DropdownMenuRadioItem
                key={font}
                value={font}
                style={{ fontFamily: FONT_STACKS[font] }}
              >
                {font}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Theme</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
          <DropdownMenuLabel className="text-[11px] text-muted-foreground">
            This page only
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={style.themeId ?? "app"}
            onValueChange={(themeId) =>
              setStyle({ themeId: themeId === "app" ? undefined : themeId })
            }
          >
            <DropdownMenuRadioItem value="app">app theme</DropdownMenuRadioItem>
            {themes.map((theme) => (
              <DropdownMenuRadioItem key={theme.id} value={theme.id}>
                {theme.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuCheckboxItem
        checked={style.smallText === true}
        onCheckedChange={(checked) =>
          setStyle({ smallText: checked === true || undefined })
        }
      >
        Small text
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={style.hideTitle === true}
        onCheckedChange={(checked) =>
          setStyle({ hideTitle: checked === true || undefined })
        }
      >
        Hide title
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
    </>
  );
}
