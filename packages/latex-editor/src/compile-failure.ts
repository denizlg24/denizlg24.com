import type { LatexCompileDiagnostic } from "@repo/schemas";

/**
 * What `onCompile` throws when the source did not build. The editor renders
 * the diagnostics above the log; any other error is shown as its message.
 */
export class LatexCompileFailure extends Error {
  constructor(
    message: string,
    readonly log: string,
    readonly diagnostics: LatexCompileDiagnostic[] = [],
  ) {
    super(message);
    this.name = "LatexCompileFailure";
  }
}
