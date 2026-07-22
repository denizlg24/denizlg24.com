import {
  type Extension,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type {
  LatexInlineCompletionRequest,
  LatexInlineCompletionResponse,
} from "@repo/schemas";
import { AdminApiError, type AdminClient } from "../client";

export interface GhostSuggestion {
  from: number;
  text: string;
}

export type LatexCompletionStatus = "idle" | "processing" | "ready";

interface GhostState {
  suggestion: GhostSuggestion | null;
  decorations: DecorationSet;
}

const setGhost = StateEffect.define<GhostSuggestion | null>();

export function advanceGhostSuggestion(
  suggestion: GhostSuggestion | null,
  change: { from: number; to: number; inserted: string } | null,
): GhostSuggestion | null {
  if (!suggestion || !change) return null;
  if (
    change.from !== suggestion.from ||
    change.to !== suggestion.from ||
    !change.inserted ||
    !suggestion.text.startsWith(change.inserted)
  ) {
    return null;
  }
  const text = suggestion.text.slice(change.inserted.length);
  return text ? { from: suggestion.from + change.inserted.length, text } : null;
}

class GhostTextWidget extends WidgetType {
  constructor(private readonly value: string) {
    super();
  }

  eq(other: GhostTextWidget): boolean {
    return other.value === this.value;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    span.className = "cm-latex-ghost-text";
    span.textContent = this.value;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
}

function decorations(suggestion: GhostSuggestion | null): DecorationSet {
  if (!suggestion?.text) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  builder.add(
    suggestion.from,
    suggestion.from,
    Decoration.widget({
      widget: new GhostTextWidget(suggestion.text),
      side: 1,
    }),
  );
  return builder.finish();
}

const ghostField = StateField.define<GhostState>({
  create: () => ({ suggestion: null, decorations: Decoration.none }),
  update(value, transaction) {
    let suggestion = value.suggestion;
    if (transaction.docChanged) {
      const changes: Array<{ from: number; to: number; inserted: string }> = [];
      transaction.changes.iterChanges((from, to, _fromB, _toB, inserted) => {
        changes.push({ from, to, inserted: inserted.toString() });
      });
      suggestion = advanceGhostSuggestion(
        suggestion,
        changes.length === 1 ? changes[0] : null,
      );
    } else if (transaction.selection) {
      suggestion = null;
    }
    for (const effect of transaction.effects) {
      if (effect.is(setGhost)) suggestion = effect.value;
    }
    return { suggestion, decorations: decorations(suggestion) };
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) => value.decorations),
});

const completionCache = new Map<string, string>();
export const DEFAULT_LATEX_COMPLETION_DELAY_MS = 3_000;

function remember(key: string, value: string) {
  completionCache.set(key, value);
  if (completionCache.size <= 100) return;
  const oldest = completionCache.keys().next().value;
  if (oldest) completionCache.delete(oldest);
}

export function canRequestLatexCompletion(
  source: string,
  cursor: number,
  filePath: string,
): boolean {
  if (filePath.toLowerCase().endsWith(".bib") || cursor <= 0) return false;
  const lineStart = source.lastIndexOf("\n", cursor - 1) + 1;
  const linePrefix = source.slice(lineStart, cursor);
  let comment = -1;
  for (let index = 0; index < linePrefix.length; index += 1) {
    if (linePrefix[index] !== "%") continue;
    let slashes = 0;
    for (
      let left = index - 1;
      left >= 0 && linePrefix[left] === "\\";
      left -= 1
    ) {
      slashes += 1;
    }
    if (slashes % 2 === 0) {
      comment = index;
      break;
    }
  }
  if (comment >= 0) return false;
  const before = source.slice(0, cursor);
  const dollars = before.match(/(?<!\\)\$/g)?.length ?? 0;
  if (dollars % 2 === 1) return false;
  if (/\\[A-Za-z@]*$/.test(linePrefix)) return false;
  if (/\\(?:cite\w*|ref|eqref|label)\{[^}]*$/.test(linePrefix)) return false;
  return /[\p{L}\p{N},.;:!?)](?:[ \t])?$/u.test(linePrefix);
}

function activeParagraph(source: string, cursor: number): string {
  const before = source.lastIndexOf("\n\n", Math.max(0, cursor - 1));
  const after = source.indexOf("\n\n", cursor);
  return source
    .slice(before < 0 ? 0 : before + 2, after < 0 ? source.length : after)
    .slice(0, 4_000);
}

export function createLatexInlineCompletionExtension(options: {
  client: AdminClient;
  projectId: string;
  getRevision: () => number;
  filePath: string;
  enabled?: boolean;
  delayMs?: number;
  onLatency?: (latencyMs: number, provider: "hosted") => void;
  onStatusChange?: (status: LatexCompletionStatus) => void;
  onTriggerChange?: (trigger: (() => void) | null) => void;
}): Extension[] {
  if (options.enabled === false) return [];
  const plugin = ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private controller: AbortController | null = null;
      private status: LatexCompletionStatus = "idle";
      private readonly triggerCallback = () => this.trigger();

      constructor(private readonly view: EditorView) {
        options.onTriggerChange?.(this.triggerCallback);
        this.schedule();
      }

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.selectionSet) return;
        this.cancelPending();
        if (update.state.field(ghostField, false)?.suggestion) {
          this.setStatus("ready");
        } else {
          this.setStatus("idle");
          this.schedule();
        }
      }

      private setStatus(status: LatexCompletionStatus) {
        if (this.status === status) return;
        this.status = status;
        options.onStatusChange?.(status);
      }

      private cancelPending() {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        this.controller?.abort();
        this.controller = null;
      }

      private schedule() {
        this.timer = setTimeout(
          () => void this.request(),
          options.delayMs ?? DEFAULT_LATEX_COMPLETION_DELAY_MS,
        );
      }

      trigger() {
        this.cancelPending();
        if (this.view.state.field(ghostField, false)?.suggestion) {
          this.view.dispatch({ effects: setGhost.of(null) });
        }
        this.view.focus();
        void this.request();
      }

      accepted() {
        this.setStatus("idle");
      }

      private async request() {
        const selection = this.view.state.selection.main;
        if (!selection.empty) {
          this.setStatus("idle");
          return;
        }
        const source = this.view.state.doc.toString();
        const cursor = selection.head;
        if (!canRequestLatexCompletion(source, cursor, options.filePath)) {
          this.setStatus("idle");
          return;
        }
        const request: LatexInlineCompletionRequest = {
          revision: options.getRevision(),
          filePath: options.filePath,
          cursor,
          prefix: source.slice(Math.max(0, cursor - 1_500), cursor),
          suffix: source.slice(cursor, cursor + 1_000),
          paragraph: activeParagraph(source, cursor),
        };
        const cacheKey = `${options.projectId}:${request.revision}:${options.filePath}:${cursor}:${request.prefix.slice(-120)}`;
        const cached = completionCache.get(cacheKey);
        if (cached) {
          this.view.dispatch({
            effects: setGhost.of({ from: cursor, text: cached }),
          });
          this.setStatus("ready");
          return;
        }
        const controller = new AbortController();
        this.controller = controller;
        this.setStatus("processing");
        try {
          let response: LatexInlineCompletionResponse;
          try {
            response = await options.client.post<LatexInlineCompletionResponse>(
              `latex/projects/${options.projectId}/completion`,
              request,
              { signal: controller.signal },
            );
          } catch (error) {
            if (
              !(error instanceof AdminApiError) ||
              error.code !== 409 ||
              controller.signal.aborted
            ) {
              throw error;
            }
            const serverRevision = (
              error.details?.project as { revision?: unknown } | undefined
            )?.revision;
            response = await options.client.post<LatexInlineCompletionResponse>(
              `latex/projects/${options.projectId}/completion`,
              {
                ...request,
                revision:
                  typeof serverRevision === "number"
                    ? serverRevision
                    : options.getRevision(),
              },
              { signal: controller.signal },
            );
          }
          if (controller.signal.aborted || !response.completion) {
            if (this.controller === controller) this.setStatus("idle");
            return;
          }
          const current = this.view.state.selection.main;
          if (
            current.head !== cursor ||
            this.view.state.doc.sliceString(
              Math.max(0, cursor - 1_500),
              cursor,
            ) !== request.prefix
          ) {
            if (this.controller === controller) this.setStatus("idle");
            return;
          }
          remember(cacheKey, response.completion);
          options.onLatency?.(response.latencyMs, response.provider);
          this.view.dispatch({
            effects: setGhost.of({ from: cursor, text: response.completion }),
          });
          this.setStatus("ready");
        } catch {
          // Inline completion is opportunistic; typing must remain uninterrupted.
          if (this.controller === controller) this.setStatus("idle");
        } finally {
          if (this.controller === controller) this.controller = null;
        }
      }

      destroy() {
        this.cancelPending();
        this.setStatus("idle");
        options.onTriggerChange?.(null);
      }
    },
  );

  return [
    ghostField,
    plugin,
    Prec.highest(
      keymap.of([
        {
          key: "Mod-Shift-Space",
          run(view) {
            const instance = view.plugin(plugin);
            if (!instance) return false;
            instance.trigger();
            return true;
          },
        },
        {
          key: "Tab",
          run(view) {
            const suggestion = view.state.field(ghostField, false)?.suggestion;
            if (!suggestion) return false;
            view.dispatch({
              changes: {
                from: suggestion.from,
                insert: suggestion.text,
              },
              selection: { anchor: suggestion.from + suggestion.text.length },
              effects: setGhost.of(null),
            });
            view.plugin(plugin)?.accepted();
            return true;
          },
        },
        {
          key: "Escape",
          run(view) {
            if (!view.state.field(ghostField, false)?.suggestion) return false;
            view.dispatch({ effects: setGhost.of(null) });
            view.plugin(plugin)?.accepted();
            return true;
          },
        },
      ]),
    ),
    EditorView.theme({
      ".cm-latex-ghost-text": {
        color: "var(--muted-foreground)",
        opacity: "0.55",
        whiteSpace: "pre-wrap",
        pointerEvents: "none",
      },
    }),
  ];
}
