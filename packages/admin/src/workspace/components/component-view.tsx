"use client";

import type { ComponentPropValues, WorkspaceComponent } from "@repo/schemas";
import { Skeleton } from "@repo/ui/skeleton";
import { useActiveTheme } from "../appearance/store";
import { HtmlFrame } from "./html-frame";
import { SpecRenderer } from "./spec-renderer";
import { useComponentData } from "./use-component-data";

type Renderable = Pick<
  WorkspaceComponent,
  "kind" | "spec" | "html" | "css" | "js" | "bindings" | "props" | "height"
>;

/** A component with its data bound: native for `spec`, a sandboxed frame for `html`. */
export function ComponentView({
  component,
  props = {},
  height,
  selectedId,
  onSelect,
}: {
  component: Renderable;
  props?: ComponentPropValues;
  height?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}) {
  const theme = useActiveTheme();
  const { scope, loading, errors } = useComponentData(
    component.bindings,
    component.props,
    props,
  );
  const failed = Object.entries(errors);

  if (loading && component.bindings.some((b) => !(b.name in scope))) {
    return <Skeleton className="h-24 w-full" />;
  }

  return (
    <div className="flex flex-col gap-1">
      {component.kind === "html" ? (
        <HtmlFrame
          html={component.html}
          css={component.css}
          js={component.js}
          scope={scope}
          height={height ?? component.height}
          themeKey={`${theme.id}:${theme.updatedAt}`}
        />
      ) : component.spec ? (
        <SpecRenderer
          spec={component.spec}
          scope={scope}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      ) : null}
      {failed.length ? (
        <span className="text-xs text-destructive">
          {failed.map(([name, error]) => `${name}: ${error}`).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}
