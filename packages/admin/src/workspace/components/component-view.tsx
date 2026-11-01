"use client";

import {
  type ComponentPropValues,
  type UiNode,
  type WorkspaceComponent,
  workflowActionResultSchema,
} from "@repo/schemas";
import { Skeleton } from "@repo/ui/skeleton";
import { useCallback } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { useAdmin } from "../../provider";
import { useActiveTheme } from "../appearance/store";
import { HtmlFrame } from "./html-frame";
import { SpecActionContext, SpecRenderer } from "./spec-renderer";
import { useComponentData } from "./use-component-data";

const actionResponseSchema = z.object({
  results: z.array(workflowActionResultSchema),
});

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
  host,
}: {
  component: Renderable;
  props?: ComponentPropValues;
  height?: number;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** The block placing it: what lets its buttons run their actions. */
  host?: { pageId: string; blockId: string };
}) {
  const { client, platform } = useAdmin();
  const theme = useActiveTheme();
  const { scope, loading, errors, reload } = useComponentData(
    component.bindings,
    component.props,
    props,
  );
  const runAction = useCallback(
    async (node: UiNode, vars: Record<string, string>) => {
      if (!host) return;
      try {
        const { results } = actionResponseSchema.parse(
          await client.post("workspace/components/actions", {
            ...host,
            nodeId: node.id,
            vars,
          }),
        );
        const failed = results.filter((r) => !r.ok);
        if (failed.length) toast.error(failed[0]?.error ?? "Action failed");
        for (const result of results) {
          if (result.ok && result.url) void platform.navigate(result.url);
        }
        reload();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Action failed");
      }
    },
    [client, platform, host, reload],
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
        <SpecActionContext.Provider value={host ? runAction : null}>
          <SpecRenderer
            spec={component.spec}
            scope={scope}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </SpecActionContext.Provider>
      ) : null}
      {failed.length ? (
        <span className="text-xs text-destructive">
          {failed.map(([name, error]) => `${name}: ${error}`).join(" · ")}
        </span>
      ) : null}
    </div>
  );
}
