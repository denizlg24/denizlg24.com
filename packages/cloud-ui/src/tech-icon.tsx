import type { ResourceKind } from "@repo/schemas/cloud";
import { Box, FileCode, Terminal } from "lucide-react";
import type { ComponentType, SVGProps } from "react";
import {
  SiAstro,
  SiDjango,
  SiDocker,
  SiFastapi,
  SiFlask,
  SiGo,
  SiHono,
  SiMeilisearch,
  SiMongodb,
  SiNestjs,
  SiNextdotjs,
  SiNodedotjs,
  SiNuxt,
  SiPostgresql,
  SiPython,
  SiReact,
  SiReactrouter,
  SiRedis,
  SiRust,
  SiSvelte,
  SiVite,
} from "react-icons/si";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/**
 * Keyed by the preset ids in `DEPLOY_PRESETS`. Adding a preset without adding
 * a mark here degrades to a generic glyph rather than breaking — the id is the
 * label the row already carries, so nothing becomes unreadable.
 */
const FRAMEWORK_ICONS: Record<string, IconComponent> = {
  astro: SiAstro,
  cra: SiReact,
  django: SiDjango,
  dockerfile: SiDocker,
  fastapi: SiFastapi,
  flask: SiFlask,
  go: SiGo,
  hono: SiHono,
  nestjs: SiNestjs,
  nextjs: SiNextdotjs,
  node: SiNodedotjs,
  nuxt: SiNuxt,
  python: SiPython,
  // The preset covers both, and React Router is what a new project of this
  // shape actually is.
  remix: SiReactrouter,
  rust: SiRust,
  static: FileCode,
  sveltekit: SiSvelte,
  vite: SiVite,
};

/**
 * `s3` deliberately has no Amazon mark. The bucket is a directory on the Pi
 * served by an S3-*compatible* API, and stamping AWS's logo on it would claim
 * an origin the bytes do not have.
 */
const RESOURCE_ICONS: Record<ResourceKind, IconComponent> = {
  meilisearch: SiMeilisearch,
  mongodb: SiMongodb,
  postgres: SiPostgresql,
  redis: SiRedis,
  s3: Box,
};

export function frameworkIcon(framework: string | null): IconComponent {
  if (!framework) return Terminal;
  return FRAMEWORK_ICONS[framework] ?? Terminal;
}

export function resourceIcon(kind: ResourceKind): IconComponent {
  return RESOURCE_ICONS[kind];
}

/**
 * Marks inherit `currentColor` rather than carrying their brand colour. A
 * dozen brand palettes in one table competes with the status dots, which are
 * the only thing on these pages where colour means something.
 */
export function TechIcon({
  icon: Icon,
  className = "size-3.5",
  label,
}: {
  icon: IconComponent;
  className?: string;
  /** Omit inside a control that already names the thing; the mark is then decorative. */
  label?: string;
}) {
  return (
    <Icon
      className={`shrink-0 ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

export function FrameworkIcon({
  framework,
  className,
  label,
}: {
  framework: string | null;
  className?: string;
  label?: string;
}) {
  return (
    <TechIcon
      icon={frameworkIcon(framework)}
      className={className}
      label={label}
    />
  );
}

export function ResourceIcon({
  kind,
  className,
  label,
}: {
  kind: ResourceKind;
  className?: string;
  label?: string;
}) {
  return (
    <TechIcon icon={resourceIcon(kind)} className={className} label={label} />
  );
}
