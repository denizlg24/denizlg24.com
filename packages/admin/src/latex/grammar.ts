import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { mapLatexProse } from "@repo/latex-editor/context";
import type { Linter } from "harper.js";

export type LatexGrammarDialect = "american" | "british";

const linterPromises = new Map<LatexGrammarDialect, Promise<Linter>>();

async function createHarperLinter(
  dialect: LatexGrammarDialect,
): Promise<Linter> {
  const [{ Dialect, WorkerLinter }, { binaryInlined }] = await Promise.all([
    import("harper.js"),
    import("harper.js/binaryInlined"),
  ]);
  const instance = new WorkerLinter({
    binary: binaryInlined,
    dialect: dialect === "british" ? Dialect.British : Dialect.American,
  });
  await instance.setup();
  return instance;
}

function getHarperLinter(dialect: LatexGrammarDialect): Promise<Linter> {
  const existing = linterPromises.get(dialect);
  if (existing) return existing;
  const created = createHarperLinter(dialect).catch((error) => {
    linterPromises.delete(dialect);
    throw error;
  });
  linterPromises.set(dialect, created);
  return created;
}

/** Harper reports Unicode scalar positions; CodeMirror uses UTF-16 offsets. */
export function scalarIndexToUtf16(text: string, scalarIndex: number): number {
  if (scalarIndex <= 0) return 0;
  let scalars = 0;
  let utf16 = 0;
  for (const character of text) {
    if (scalars >= scalarIndex) break;
    utf16 += character.length;
    scalars += 1;
  }
  return utf16;
}

export function createLatexGrammarExtension(options: {
  dialect: LatexGrammarDialect;
  filePath: string;
  delayMs?: number;
}): Extension[] {
  if (!options.filePath.toLowerCase().endsWith(".tex")) return [];

  return [
    linter(
      async (view) => {
        const source = view.state.doc.toString();
        const prose = mapLatexProse(source);
        if (!prose.masked.trim()) return [];
        const harper = await getHarperLinter(options.dialect);
        const findings = await harper.lint(prose.masked, {
          language: "plaintext",
          dedup: true,
        });

        const diagnostics: Diagnostic[] = [];
        for (const finding of findings) {
          const span = finding.span();
          const from = scalarIndexToUtf16(prose.masked, span.start);
          const to = scalarIndexToUtf16(prose.masked, span.end);
          if (to < from || from < 0 || to > source.length) continue;
          // A finding that touches only masked LaTeX is never actionable prose.
          if (!prose.masked.slice(from, to).trim()) continue;
          const replacements = [
            ...new Set(
              finding
                .suggestions()
                .map((suggestion) => suggestion.get_replacement_text()),
            ),
          ].slice(0, 3);
          diagnostics.push({
            from,
            to,
            severity: "warning",
            source: "Harper",
            message: finding.message(),
            actions: replacements.map((replacement) => ({
              name: replacement || "Remove",
              apply(editor, currentFrom, currentTo) {
                editor.dispatch({
                  changes: {
                    from: currentFrom,
                    to: currentTo,
                    insert: replacement,
                  },
                });
              },
            })),
          });
        }
        return diagnostics;
      },
      { delay: options.delayMs ?? 450 },
    ),
  ];
}
