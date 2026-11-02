"use client";

import { type Appearance, parseIconValue } from "@repo/schemas";
import { cn } from "@repo/ui/utils";
import type { LucideIcon, LucideProps } from "lucide-react";
import { forwardRef } from "react";
import {
  MODULE_SECTIONS,
  type ModuleDef,
  type ModuleSection,
} from "../modules";
import { AppIcon, ICON_COLOR_CLASS, lucideIcon } from "../page-icon";
import type { WorkspaceNav } from "../refs";

const iconCache = new Map<string, LucideIcon>();

/** A module icon from an icon value; null for an emoji or an unknown lucide name. */
function moduleIcon(value: string): LucideIcon | null {
  const cached = iconCache.get(value);
  if (cached) return cached;
  const parsed = parseIconValue(value);
  if (parsed.kind === "react-icon") {
    // Module rows render a component; this one draws the lazily loaded glyph.
    const Library = forwardRef<SVGSVGElement, LucideProps>(
      ({ className }, _ref) => <AppIcon value={value} className={className} />,
    );
    Library.displayName = `ReactIcon(${parsed.name})`;
    iconCache.set(value, Library);
    return Library;
  }
  if (parsed.kind !== "icon") return null;
  const Glyph = lucideIcon(parsed.name);
  if (!Glyph) return null;
  if (parsed.color === "default") {
    iconCache.set(value, Glyph);
    return Glyph;
  }
  const colour = ICON_COLOR_CLASS[parsed.color];
  const Tinted = forwardRef<SVGSVGElement, LucideProps>(
    ({ className, ...props }, ref) => (
      <Glyph ref={ref} {...props} className={cn(className, colour)} />
    ),
  );
  Tinted.displayName = `Tinted(${parsed.name})`;
  iconCache.set(value, Tinted);
  return Tinted;
}

function byOrder<T>(items: T[], key: (item: T) => string, order: string[]) {
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = rank.get(key(a.item)) ?? order.length + a.index;
      const rb = rank.get(key(b.item)) ?? order.length + b.index;
      return ra - rb;
    })
    .map(({ item }) => item);
}

export type CustomizedNav = WorkspaceNav & {
  /** Module sections in the owner's order. */
  sections: ModuleSection[];
};

const cache = new WeakMap<WorkspaceNav, { key: string; nav: CustomizedNav }>();

/** The nav with the owner's module labels, icons and order applied. */
export function customizeNav(
  nav: WorkspaceNav,
  appearance: Pick<Appearance, "modules" | "moduleOrder" | "sectionOrder">,
): CustomizedNav {
  const key = JSON.stringify([
    appearance.modules,
    appearance.moduleOrder,
    appearance.sectionOrder,
  ]);
  const hit = cache.get(nav);
  if (hit && hit.key === key) return hit.nav;

  const dress = (module: ModuleDef): ModuleDef => {
    const custom = appearance.modules[module.id];
    if (!custom) return module;
    const icon = custom.icon ? moduleIcon(custom.icon) : null;
    return {
      ...module,
      ...(custom.label ? { label: custom.label } : {}),
      ...(icon ? { icon } : {}),
    };
  };
  const modules = byOrder(
    nav.modules.map(dress),
    (m) => m.id,
    appearance.moduleOrder,
  );
  const byId = new Map(modules.map((m) => [m.id as string, m]));

  const customized: CustomizedNav = {
    ...nav,
    modules,
    sidebarModules: modules.filter((m) => !m.shortcut),
    getModule: (id) => byId.get(id),
    resolveRef: (ref, pages) => {
      const resolved = nav.resolveRef(ref, pages);
      if (resolved?.kind !== "module") return resolved;
      const module = byId.get(resolved.module.id) ?? resolved.module;
      return { ...resolved, module, label: module.label };
    },
    sections: byOrder(MODULE_SECTIONS, (s) => s.id, appearance.sectionOrder),
  };
  cache.set(nav, { key, nav: customized });
  return customized;
}
