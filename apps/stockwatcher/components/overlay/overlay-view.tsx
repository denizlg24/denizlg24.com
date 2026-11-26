"use client";

import { Pin, Plus, Save, Trash2, X } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import type { Save as SaveWorkspace } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { defaultDesk } from "@/lib/desk";
import { studyInfo } from "@/lib/indicators";
import type { Workspace } from "@/lib/models";
import {
  decodeOverlay,
  encodeOverlay,
  type OverlayAxis,
  type OverlayMode,
  type OverlayRange,
  type OverlaySeries,
  overlayRanges,
  overlayStudies,
  parseExpression,
  quickSeries,
} from "@/lib/overlay";
import { OverlayChart, seriesColors } from "./overlay-chart";

const MAX_SERIES = 8;
const starter = "^GSPC,l,r;^VIX,r,p,i";

export function OverlayView({
  spec,
  period,
  onChange,
  workspace,
  save,
  notify,
}: {
  spec?: string;
  period?: OverlayRange;
  onChange: (spec: string, period: OverlayRange) => void;
  workspace: Workspace;
  save: SaveWorkspace;
  notify: (text: string, error?: boolean) => void;
}) {
  const series = decodeOverlay(spec ?? starter);
  const range = period ?? "1Y";
  const [draft, setDraft] = useState("");
  const [name, setName] = useState("");
  const parsed = draft.trim() ? parseExpression(draft) : null;
  const commit = (next: OverlaySeries[], nextRange = range) =>
    onChange(encodeOverlay(next), nextRange);
  const update = (index: number, patch: Partial<OverlaySeries>) =>
    commit(
      series.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  function add(expr: string) {
    const check = parseExpression(expr);
    if (!check.ok || series.length >= MAX_SERIES) return;
    commit([
      ...series,
      {
        expr: expr.trim().toUpperCase(),
        axis: series.length === 0 ? "left" : "right",
        mode: "price",
        invert: false,
        studies: [],
      },
    ]);
    setDraft("");
  }
  async function saveLayout() {
    const title = name.trim() || series.map((item) => item.expr).join(" vs ");
    const encoded = encodeOverlay(series);
    try {
      await save((current) => ({
        ...current,
        overlays: [
          ...current.overlays.filter((item) => item.name !== title),
          {
            id: crypto.randomUUID(),
            name: title.slice(0, 120),
            spec: encoded,
            range,
          },
        ].slice(-30),
      }));
      setName("");
      notify(`Saved “${title}”.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not save.", true);
    }
  }
  async function pin() {
    const title =
      name.trim() ||
      series
        .map((item) => item.expr)
        .join(" vs ")
        .slice(0, 80);
    try {
      await save((current) => ({
        ...current,
        desk: {
          widgets: [
            ...(current.desk ?? defaultDesk(() => crypto.randomUUID())).widgets,
            {
              id: crypto.randomUUID(),
              span: 2 as const,
              kind: "overlay" as const,
              title,
              spec: encodeOverlay(series),
              range,
            },
          ].slice(-24),
        },
      }));
      notify(`Pinned “${title}” to your desk.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Could not pin.", true);
    }
  }

  return (
    <section className="panel overlay-panel">
      <div className="overlay-builder">
        <form
          className="overlay-add"
          onSubmit={(event) => {
            event.preventDefault();
            add(draft);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toUpperCase())}
            placeholder="Add series: ^VIX · FRED:DGS10 · NVDA / SMH · (XLY / XLP) * 100"
            aria-label="Series expression"
            aria-invalid={parsed?.ok === false || undefined}
            spellCheck={false}
            maxLength={120}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!parsed?.ok || series.length >= MAX_SERIES}
          >
            <Plus /> Add
          </Button>
          {parsed && !parsed.ok ? (
            <span className="overlay-error" role="status">
              {parsed.error}
            </span>
          ) : null}
        </form>
        <div className="overlay-quick" aria-label="Quick add">
          {quickSeries.map((item) => (
            <button
              key={item.expr}
              type="button"
              className="chip"
              disabled={series.some((row) => row.expr === item.expr)}
              onClick={() => add(item.expr)}
              title={item.expr}
            >
              + {item.label}
            </button>
          ))}
        </div>
        <ol className="overlay-series">
          {series.map((item, index) => (
            <li key={`${item.expr}-${index}`}>
              <i
                className="overlay-swatch"
                style={{
                  background: seriesColors[index % seriesColors.length],
                }}
                aria-hidden
              />
              <code>{item.expr}</code>
              <select
                aria-label={`${item.expr} axis`}
                value={item.axis}
                onChange={(event) =>
                  update(index, { axis: event.target.value as OverlayAxis })
                }
              >
                <option value="left">Left axis</option>
                <option value="right">Right axis</option>
                <option value="pane">Own pane</option>
              </select>
              <select
                aria-label={`${item.expr} scale`}
                value={item.mode}
                onChange={(event) =>
                  update(index, { mode: event.target.value as OverlayMode })
                }
              >
                <option value="price">Level</option>
                <option value="rebased">% from start</option>
                <option value="zscore">Z-score</option>
              </select>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={item.invert}
                  onChange={(event) =>
                    update(index, { invert: event.target.checked })
                  }
                />{" "}
                Invert
              </label>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="chip">
                    Studies
                    {item.studies.length ? ` · ${item.studies.length}` : ""}
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    className="menu-content"
                    align="start"
                    sideOffset={4}
                  >
                    {overlayStudies.map((key) => (
                      <DropdownMenu.CheckboxItem
                        key={key}
                        className="menu-item"
                        checked={item.studies.includes(key)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={(checked) =>
                          update(index, {
                            studies: checked
                              ? [...item.studies, key]
                              : item.studies.filter((study) => study !== key),
                          })
                        }
                      >
                        {studyInfo.get(key)?.label}
                        <DropdownMenu.ItemIndicator className="menu-check">
                          ✓
                        </DropdownMenu.ItemIndicator>
                      </DropdownMenu.CheckboxItem>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
              <button
                type="button"
                className="overlay-remove"
                aria-label={`Remove ${item.expr}`}
                onClick={() => commit(series.filter((_, i) => i !== index))}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ol>
        <div className="overlay-actions">
          <div className="seg" role="group" aria-label="Period">
            {overlayRanges.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === range}
                onClick={() => commit(series, option)}
              >
                {option}
              </button>
            ))}
          </div>
          <div className="overlay-save">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Layout name"
              aria-label="Layout name"
              maxLength={80}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!series.length}
              onClick={() => void saveLayout()}
            >
              <Save /> Save
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!series.length}
              onClick={() => void pin()}
            >
              <Pin /> Pin to desk
            </Button>
          </div>
        </div>
        {workspace.overlays.length ? (
          <ul className="overlay-layouts" aria-label="Saved layouts">
            {workspace.overlays.map((layout) => (
              <li key={layout.id}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={
                    layout.spec === encodeOverlay(series) &&
                    layout.range === range
                  }
                  onClick={() => onChange(layout.spec, layout.range)}
                >
                  {layout.name}
                </button>
                <button
                  type="button"
                  className="overlay-remove"
                  aria-label={`Delete ${layout.name}`}
                  onClick={() =>
                    void save((current) => ({
                      ...current,
                      overlays: current.overlays.filter(
                        (item) => item.id !== layout.id,
                      ),
                    })).catch((error: Error) => notify(error.message, true))
                  }
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <OverlayChart series={series} range={range} />
    </section>
  );
}
