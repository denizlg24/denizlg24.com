"use client";

import type { WorkspaceComponent } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { Blocks, Bot, Plus } from "lucide-react";
import { useState } from "react";
import { useAdmin } from "../../provider";
import { ComponentEditor } from "../../workspace/components/component-editor";
import {
  useComponentLibrary,
  useComponentList,
} from "../../workspace/components/library";
import { AppIcon } from "../../workspace/page-icon";
import { SettingsGroup } from "../settings-shell";

/** The component library: every custom UI element, opened in the editor. */
export function ComponentsSection() {
  const { client } = useAdmin();
  const list = useComponentList();
  const ensure = useComponentLibrary((s) => s.ensure);
  const [editing, setEditing] = useState<WorkspaceComponent | null | "new">(
    null,
  );

  const open = async (id: string) => {
    await ensure(client, id, true);
    const loaded = useComponentLibrary.getState().byId[id];
    if (loaded && loaded !== "missing") setEditing(loaded);
  };

  return (
    <SettingsGroup
      label="Components"
      actions={
        <Button variant="ghost" size="xs" onClick={() => setEditing("new")}>
          <Plus /> New
        </Button>
      }
    >
      {list === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
        </div>
      ) : list.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div className="flex flex-col divide-y divide-border">
          {list.map((component) => (
            <button
              key={component.id}
              type="button"
              onClick={() => void open(component.id)}
              className="flex items-center gap-3 py-2 text-left"
            >
              <AppIcon
                value={component.icon}
                fallback={Blocks}
                className="text-muted-foreground"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1.5 text-sm text-accent-strong">
                  {component.name}
                  {component.createdBy !== "owner" ? (
                    <Bot
                      className="size-3 text-muted-foreground"
                      aria-label={component.createdBy}
                    />
                  ) : null}
                </span>
                {component.description ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {component.description}
                  </span>
                ) : null}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {component.kind === "spec" ? "native" : "html"}
              </span>
            </button>
          ))}
        </div>
      )}
      <ComponentEditor
        open={editing !== null}
        onOpenChange={(next) => {
          if (!next) setEditing(null);
        }}
        component={editing === "new" ? null : editing}
      />
    </SettingsGroup>
  );
}
