"use client";

import {
  THEME_CORE_TOKENS,
  THEME_EFFECTS,
  THEME_EXTRA_TOKENS,
  THEME_FONTS,
  type Theme,
  type ThemeColors,
  type ThemeInput,
  type ThemeToken,
  themeInputSchema,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { FormDialog } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { SegmentedControl } from "@repo/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Slider } from "@repo/ui/slider";
import { Textarea } from "@repo/ui/textarea";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppIcon, IconPicker } from "../page-icon";
import { UploadButton } from "../upload";
import { useAppearanceStore } from "./store";

type Draft = ThemeInput & { colors: ThemeColors };

const TOKEN_LABEL: Record<ThemeToken, string> = {
  background: "Background",
  foreground: "Text",
  surface: "Surface",
  muted: "Muted",
  mutedForeground: "Muted text",
  accent: "Accent",
  accentStrong: "Emphasis",
  border: "Border",
  accentForeground: "On accent",
  primary: "Primary",
  primaryForeground: "On primary",
  card: "Card",
  popover: "Popover",
  input: "Input",
  ring: "Focus ring",
  destructive: "Destructive",
  sidebar: "Sidebar",
  sidebarForeground: "Sidebar text",
  sidebarAccent: "Sidebar hover",
  sidebarBorder: "Sidebar border",
  chart1: "Chart 1",
  chart2: "Chart 2",
  chart3: "Chart 3",
  chart4: "Chart 4",
  chart5: "Chart 5",
  chart6: "Chart 6",
};

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

/** A colour swatch input plus its text, which takes any CSS colour. */
function ColorField({
  token,
  value,
  optional,
  onChange,
}: {
  token: ThemeToken;
  value: string | undefined;
  optional: boolean;
  onChange: (value: string | undefined) => void;
}) {
  const hex = value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#888888";
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        aria-label={TOKEN_LABEL[token]}
        value={hex}
        onChange={(event) => onChange(event.target.value)}
        className="size-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-xs text-accent-strong">{TOKEN_LABEL[token]}</span>
        <input
          aria-label={`${TOKEN_LABEL[token]} value`}
          value={value ?? ""}
          placeholder={optional ? "derived" : ""}
          onChange={(event) => onChange(event.target.value.trim() || undefined)}
          className="min-w-0 bg-transparent font-mono text-[11px] text-muted-foreground outline-none"
        />
      </div>
    </div>
  );
}

function draftOf(theme: Theme | null, base: Theme): Draft {
  const source = theme ?? base;
  return {
    name: theme ? source.name : `${base.name} copy`,
    description: source.description,
    scheme: source.scheme,
    colors: { ...source.colors },
    radius: source.radius,
    fonts: { ...source.fonts },
    effect: { ...source.effect },
    ornament: { ...source.ornament },
    background: source.background,
    fontImport: source.fontImport,
    css: source.css,
  };
}

/**
 * Edits a theme with the whole app as its preview: every change is applied
 * live while the dialog is open and dropped on cancel.
 */
export function ThemeEditor({
  open,
  onOpenChange,
  theme,
  base,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null creates a new theme starting from `base`. */
  theme: Theme | null;
  base: Theme;
}) {
  const setPreview = useAppearanceStore((s) => s.setPreview);
  const createTheme = useAppearanceStore((s) => s.createTheme);
  const updateTheme = useAppearanceStore((s) => s.updateTheme);
  const [draft, setDraft] = useState<Draft>(() => draftOf(theme, base));
  const [showExtra, setShowExtra] = useState(false);
  const [pending, setPending] = useState(false);

  const latest = useRef({ theme, base });
  latest.current = { theme, base };
  const seedKey = open ? `${theme?.id ?? "new"}:${base.id}` : null;
  // Re-seed on open or a different theme only: the store replaces theme
  // objects on every appearance poll, which must not wipe an edit.
  useEffect(() => {
    if (seedKey === null) return;
    setDraft(draftOf(latest.current.theme, latest.current.base));
  }, [seedKey]);

  const parsed = useMemo(() => themeInputSchema.safeParse(draft), [draft]);

  useEffect(() => {
    if (!open) {
      setPreview(null);
      return;
    }
    if (parsed.success) {
      setPreview({
        ...parsed.data,
        id: theme?.id ?? "preview",
        builtin: false,
        createdBy: "owner",
        createdAt: "",
        updatedAt: String(Date.now()),
      });
    }
  }, [open, parsed, theme, setPreview]);

  useEffect(() => () => setPreview(null), [setPreview]);

  const setColor = (token: ThemeToken, value: string | undefined) =>
    setDraft((d) => {
      const colors = { ...d.colors };
      if (value === undefined) delete colors[token];
      else colors[token] = value;
      return { ...d, colors: colors as ThemeColors };
    });

  const save = async () => {
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid theme");
      return;
    }
    setPending(true);
    const saved = theme
      ? await updateTheme(theme.id, parsed.data)
      : await createTheme(parsed.data);
    setPending(false);
    if (saved) onOpenChange(false);
    else toast.error("Save failed");
  };

  const effect = draft.effect ?? { kind: "none", density: 0.4 };
  const fonts = draft.fonts ?? { body: "sans", heading: "sans" };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={theme ? "Edit theme" : "New theme"}
      size="lg"
      onSubmit={save}
      pending={pending}
      submitDisabled={!parsed.success}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_12rem]">
          <Input
            aria-label="Name"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            className="text-base font-semibold"
          />
          <SegmentedControl
            ariaLabel="Scheme"
            value={draft.scheme ?? "light"}
            className="[&_button]:min-h-8 [&_button]:text-xs"
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
            onValueChange={(scheme) => setDraft({ ...draft, scheme })}
          />
        </div>

        <section className="flex flex-col gap-3">
          <span className={LABEL}>Colours</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {THEME_CORE_TOKENS.map((token) => (
              <ColorField
                key={token}
                token={token}
                value={draft.colors[token]}
                optional={false}
                onChange={(v) => v && setColor(token, v)}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="w-fit text-muted-foreground"
            onClick={() => setShowExtra((v) => !v)}
          >
            {showExtra ? "Fewer" : "More colours"}
          </Button>
          {showExtra ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {THEME_EXTRA_TOKENS.map((token) => (
                <ColorField
                  key={token}
                  token={token}
                  value={draft.colors[token]}
                  optional
                  onChange={(v) => setColor(token, v)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Body font</span>
            <Select
              value={fonts.body}
              onValueChange={(body) =>
                setDraft({
                  ...draft,
                  fonts: {
                    ...fonts,
                    body: body as (typeof THEME_FONTS)[number],
                  },
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_FONTS.map((font) => (
                  <SelectItem key={font} value={font}>
                    {font}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Heading font</span>
            <Select
              value={fonts.heading}
              onValueChange={(heading) =>
                setDraft({
                  ...draft,
                  fonts: {
                    ...fonts,
                    heading: heading as (typeof THEME_FONTS)[number],
                  },
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_FONTS.map((font) => (
                  <SelectItem key={font} value={font}>
                    {font}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>
              Radius{" "}
              <span className="tabular-nums">
                {(draft.radius ?? 0.625).toFixed(2)}
              </span>
            </span>
            <Slider
              aria-label="Radius"
              min={0}
              max={1.5}
              step={0.05}
              value={[draft.radius ?? 0.625]}
              onValueChange={([radius]) => setDraft({ ...draft, radius })}
            />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem_10rem]">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Webfont stylesheet</span>
            <Input
              aria-label="Webfont stylesheet URL"
              placeholder="https://fonts.googleapis.com/css2?family=…"
              value={draft.fontImport?.url ?? ""}
              onChange={(event) => {
                const url = event.target.value.trim();
                setDraft({
                  ...draft,
                  fontImport: url ? { ...draft.fontImport, url } : null,
                });
              }}
              className="h-8 text-xs"
            />
          </div>
          {(["body", "heading"] as const).map((slot) => (
            <div key={slot} className="flex flex-col gap-1.5">
              <span className={LABEL}>
                {slot === "body" ? "Body family" : "Heading family"}
              </span>
              <Input
                aria-label={`${slot} font family`}
                disabled={!draft.fontImport}
                placeholder="Fraunces"
                value={draft.fontImport?.[slot] ?? ""}
                onChange={(event) => {
                  if (!draft.fontImport) return;
                  const family = event.target.value;
                  const { [slot]: _old, ...rest } = draft.fontImport;
                  setDraft({
                    ...draft,
                    fontImport: family.trim()
                      ? { ...rest, [slot]: family }
                      : rest,
                  });
                }}
                className="h-8 text-xs"
              />
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Effect</span>
            <Select
              value={effect.kind ?? "none"}
              onValueChange={(kind) =>
                setDraft({
                  ...draft,
                  effect: {
                    ...effect,
                    kind: kind as (typeof THEME_EFFECTS)[number],
                  },
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_EFFECTS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {kind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Density</span>
            <Slider
              aria-label="Effect density"
              min={0}
              max={1}
              step={0.05}
              value={[effect.density ?? 0.4]}
              onValueChange={([density]) =>
                setDraft({ ...draft, effect: { ...effect, density } })
              }
            />
          </div>
          <div className="flex items-end gap-3">
            {(["title", "sidebar"] as const).map((slot) => (
              <div key={slot} className="flex flex-col gap-1.5">
                <span className={LABEL}>
                  {slot === "title" ? "Title" : "Sidebar"}
                </span>
                <IconPicker
                  value={draft.ornament?.[slot] ?? null}
                  onChange={(icon) =>
                    setDraft({
                      ...draft,
                      ornament: {
                        ...draft.ornament,
                        [slot]: icon ?? undefined,
                      },
                    })
                  }
                >
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                  >
                    {draft.ornament?.[slot] ? (
                      <AppIcon value={draft.ornament[slot]} />
                    ) : (
                      "—"
                    )}
                  </Button>
                </IconPicker>
              </div>
            ))}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_8rem_8rem]">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Background image</span>
            <div className="flex gap-2">
              <UploadButton
                accept="image/*"
                variant="outline"
                className="h-8 shrink-0"
                onUploaded={(url) =>
                  setDraft({
                    ...draft,
                    background: {
                      opacity: 0.15,
                      size: "cover",
                      ...draft.background,
                      url,
                    },
                  })
                }
              />
              <Input
                aria-label="Background image URL"
                placeholder="https://"
                value={draft.background?.url ?? ""}
                onChange={(event) => {
                  const url = event.target.value.trim();
                  setDraft({
                    ...draft,
                    background: url
                      ? {
                          opacity: 0.15,
                          size: "cover",
                          ...draft.background,
                          url,
                        }
                      : null,
                  });
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Opacity</span>
            <Slider
              aria-label="Background opacity"
              disabled={!draft.background}
              min={0}
              max={1}
              step={0.05}
              value={[draft.background?.opacity ?? 0.15]}
              onValueChange={([opacity]) =>
                draft.background &&
                setDraft({
                  ...draft,
                  background: { ...draft.background, opacity },
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Fit</span>
            <Select
              disabled={!draft.background}
              value={draft.background?.size ?? "cover"}
              onValueChange={(size) =>
                draft.background &&
                setDraft({
                  ...draft,
                  background: {
                    ...draft.background,
                    size: size as "cover" | "contain" | "tile",
                  },
                })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cover">cover</SelectItem>
                <SelectItem value="contain">contain</SelectItem>
                <SelectItem value="tile">tile</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className={LABEL}>CSS</span>
          <Textarea
            aria-label="Theme CSS"
            rows={6}
            spellCheck={false}
            value={draft.css ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, css: event.target.value })
            }
            className="font-mono text-xs"
          />
          {!parsed.success ? (
            <span className="text-xs text-destructive">
              {parsed.error.issues[0]?.path.join(".")}:{" "}
              {parsed.error.issues[0]?.message}
            </span>
          ) : null}
        </section>
      </div>
    </FormDialog>
  );
}
