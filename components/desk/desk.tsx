"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  GripVertical,
  LayoutGrid,
  Plus,
  RotateCcw,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Failure } from "@/components/shared";
import type { Save } from "@/components/forms";
import type { DashboardState } from "@/lib/assistant-types";
import { defaultDesk, type Widget } from "@/lib/desk";
import type { Workspace } from "@/lib/models";
import { cn } from "@/lib/utils";
import { AddWidgetDialog, widgetCatalog } from "./add-widget";
import { HoldingsWidget, MoversWidget } from "./book";
import { BriefWidget } from "./brief";
import { AlertsWidget, InsightWidget, NewsWidget } from "./feeds";
import {
  ChartWidget,
  CompareWidget,
  MarketWidget,
  WatchlistWidget,
} from "./markets";
import { DeskEmpty, FrameContext, type WidgetContext } from "./frame";

export type DeskProps = {
  workspace: Workspace;
  save: Save;
  refresh: boolean;
  aiEnabled: boolean;
  onOpenSymbol: (symbol: string) => void;
  onOpenView: (state: DashboardState) => void;
  onAsk?: (prompt: string) => void;
};

function WidgetView({ widget, ctx }: { widget: Widget; ctx: WidgetContext }) {
  switch (widget.kind) {
    case "brief":
      return <BriefWidget widget={widget} ctx={ctx} />;
    case "holdings":
      return <HoldingsWidget widget={widget} ctx={ctx} />;
    case "movers":
      return <MoversWidget widget={widget} ctx={ctx} />;
    case "watchlist":
      return <WatchlistWidget widget={widget} ctx={ctx} />;
    case "chart":
      return <ChartWidget widget={widget} ctx={ctx} />;
    case "news":
      return <NewsWidget widget={widget} ctx={ctx} />;
    case "alerts":
      return <AlertsWidget widget={widget} ctx={ctx} />;
    case "compare":
      return <CompareWidget widget={widget} ctx={ctx} />;
    case "market":
      return <MarketWidget widget={widget} ctx={ctx} />;
    case "insight":
      return <InsightWidget widget={widget} ctx={ctx} />;
  }
}

function move(widgets: Widget[], id: string, to: number) {
  const from = widgets.findIndex((widget) => widget.id === id);
  if (from < 0 || to < 0 || to >= widgets.length || from === to) return widgets;
  const next = widgets.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function Desk({
  workspace,
  save,
  refresh,
  aiEnabled,
  onOpenSymbol,
  onOpenView,
  onAsk,
}: DeskProps) {
  const [fallback] = useState(() => defaultDesk(() => crypto.randomUUID()));
  const widgets = (workspace.desk ?? fallback).widgets;
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [error, setError] = useState<Error>();

  const change = useCallback(
    async (update: (widgets: Widget[]) => Widget[]) => {
      setError(undefined);
      try {
        await save((current) => ({
          ...current,
          desk: { widgets: update((current.desk ?? fallback).widgets) },
        }));
      } catch (cause) {
        const failure =
          cause instanceof Error
            ? cause
            : new Error("The desk layout could not be saved.");
        setError(failure);
        throw failure;
      }
    },
    [save, fallback],
  );
  const quietly = useCallback(
    (update: (widgets: Widget[]) => Widget[]) =>
      change(update).catch(() => undefined),
    [change],
  );

  const contexts = useMemo(
    () =>
      new Map(
        widgets.map((widget) => [
          widget.id,
          {
            workspace,
            refresh,
            aiEnabled,
            onOpenSymbol,
            onOpenView,
            update: (next: Widget) =>
              quietly((list) =>
                list.map((item) => (item.id === widget.id ? next : item)),
              ),
            remove: () =>
              quietly((list) => list.filter((item) => item.id !== widget.id)),
          } satisfies WidgetContext,
        ]),
      ),
    [widgets, workspace, refresh, aiEnabled, onOpenSymbol, onOpenView, quietly],
  );

  function controls(widget: Widget, index: number): ReactNode {
    const label = widgetCatalog[widget.kind].label;
    return (
      <>
        <span className="desk-grip" aria-hidden title="Drag to reorder">
          <GripVertical />
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${label} up`}
          title="Move up"
          disabled={index === 0}
          onClick={() =>
            void quietly((list) => move(list, widget.id, index - 1))
          }
        >
          <ArrowUp />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Move ${label} down`}
          title="Move down"
          disabled={index === widgets.length - 1}
          onClick={() =>
            void quietly((list) => move(list, widget.id, index + 1))
          }
        >
          <ArrowDown />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={
            widget.span === 2
              ? `Make ${label} half width`
              : `Make ${label} full width`
          }
          title={widget.span === 2 ? "Half width" : "Full width"}
          onClick={() =>
            void quietly((list) =>
              list.map((item) =>
                item.id === widget.id
                  ? { ...item, span: item.span === 2 ? 1 : 2 }
                  : item,
              ),
            )
          }
        >
          {widget.span === 2 ? <Square /> : <Columns2 />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${label}`}
          title="Remove"
          onClick={() =>
            void quietly((list) => list.filter((item) => item.id !== widget.id))
          }
        >
          <Trash2 />
        </Button>
      </>
    );
  }

  return (
    <div className={cn("desk", editing && "desk-editing")}>
      <div className="desk-toolbar">
        <span className="meta">
          {editing
            ? "Drag or use the arrows to reorder · changes save immediately"
            : `${widgets.length} widget${widgets.length === 1 ? "" : "s"}${workspace.desk ? "" : " · default layout"}`}
        </span>
        <div className="row-actions">
          {editing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void quietly(
                    () => defaultDesk(() => crypto.randomUUID()).widgets,
                  )
                }
              >
                <RotateCcw /> Reset
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={widgets.length >= 24}
                onClick={() => setAdding(true)}
              >
                <Plus /> Add widget
              </Button>
              <Button size="sm" onClick={() => setEditing(false)}>
                Done
              </Button>
            </>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              <LayoutGrid /> Edit desk
            </Button>
          )}
        </div>
      </div>
      <Failure error={error} />
      {widgets.length === 0 ? (
        <section className="section">
          <DeskEmpty
            title="Your desk is empty"
            action={
              <Button
                size="sm"
                onClick={() => {
                  setEditing(true);
                  setAdding(true);
                }}
              >
                <Plus /> Add a widget
              </Button>
            }
          >
            Pin holdings, charts, news or alerts here, or ask the assistant to
            pin something for you.
          </DeskEmpty>
        </section>
      ) : (
        <div className="desk-grid">
          {widgets.map((widget, index) => {
            const ctx = contexts.get(widget.id);
            if (!ctx) return null;
            return (
              <div
                key={widget.id}
                className={cn(
                  "desk-cell",
                  dragging === widget.id && "desk-dragging",
                  dropTarget === widget.id &&
                    dragging !== widget.id &&
                    "desk-drop",
                )}
                data-span={widget.span}
                data-kind={widget.kind}
                draggable={editing}
                onDragStart={(event) => {
                  if (!editing) return;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", widget.id);
                  setDragging(widget.id);
                }}
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  if (dropTarget !== widget.id) setDropTarget(widget.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const id = dragging;
                  setDragging(null);
                  setDropTarget(null);
                  if (id && id !== widget.id)
                    void quietly((list) =>
                      move(
                        list,
                        id,
                        list.findIndex((item) => item.id === widget.id),
                      ),
                    );
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDropTarget(null);
                }}
              >
                <FrameContext
                  value={{
                    editing,
                    controls: controls(widget, index),
                    onAsk,
                  }}
                >
                  <WidgetView widget={widget} ctx={ctx} />
                </FrameContext>
              </div>
            );
          })}
        </div>
      )}
      {adding ? (
        <AddWidgetDialog
          workspace={workspace}
          close={() => setAdding(false)}
          add={(widget) => change((list) => [...list, widget])}
        />
      ) : null}
    </div>
  );
}
