import { LanguageSupport } from "@codemirror/language";
import { styleTags, tags } from "@lezer/highlight";
import { latex, latexLanguage } from "codemirror-lang-latex";

// Command tokens the bundled grammar tokenizes distinctly but never assigns a
// highlight tag, so \item, \textcolor, \input, … render as plain text without
// this. ruleNodeProp.combine merges these with the grammar's own styleTags.
const extraCommandTags = styleTags({
  [[
    "ItemCtrlSeq",
    "TextColorCtrlSeq",
    "ColorBoxCtrlSeq",
    "HrefCtrlSeq",
    "UrlCtrlSeq",
    "FootnoteCtrlSeq",
    "EndnoteCtrlSeq",
    "CaptionCtrlSeq",
    "CenteringCtrlSeq",
    "MaketitleCtrlSeq",
    "HLineCtrlSeq",
    "MidRuleCtrlSeq",
    "TopRuleCtrlSeq",
    "BottomRuleCtrlSeq",
    "MultiColumnCtrlSeq",
    "LeftCtrlSeq",
    "RightCtrlSeq",
    "HboxCtrlSeq",
    "ParBoxCtrlSeq",
    "MathTextCtrlSeq",
    "SetLengthCtrlSeq",
    "AffilCtrlSeq",
    "AffiliationCtrlSeq",
    "InputCtrlSeq",
    "IncludeCtrlSeq",
    "IncludeOnlyCtrlSeq",
    "IncludeGraphicsCtrlSeq",
    "IncludeSvgCtrlSeq",
    "SubfileCtrlSeq",
    "VerbCtrlSeq",
    "LstInlineCtrlSeq",
    "TextMediumCtrlSeq",
    "TextSansSerifCtrlSeq",
    "TextStrikeOutCtrlSeq",
    "TextSubscriptCtrlSeq",
    "TextSuperscriptCtrlSeq",
  ].join(" ")]: tags.keyword,
  [[
    "NewCommandCtrlSeq",
    "RenewCommandCtrlSeq",
    "NewEnvironmentCtrlSeq",
    "RenewEnvironmentCtrlSeq",
    "NewTheoremCtrlSeq",
    "TheoremStyleCtrlSeq",
    "DefCtrlSeq",
    "LetCtrlSeq",
    "BiblatexCtrlSeq",
  ].join(" ")]: tags.definitionKeyword,
});

const highlightedLatexLanguage = latexLanguage.configure({
  props: [extraCommandTags],
});

export interface LatexSupportOptions {
  /** Path of the file being edited; drives .sty/.cls detection in the linter. */
  fileName: string;
  /** The project entry point that owns \begin{document}. */
  isMainFile: boolean;
  /** Project has more than one .tex file, so labels/refs/cites span buffers. */
  isMultiFile: boolean;
}

export function latexSupport({
  fileName,
  isMainFile,
  isMultiFile,
}: LatexSupportOptions): LanguageSupport {
  const base = latex({
    fileName,
    linter: {
      // Only the entry point carries \begin{document}; imports are fragments.
      checkMissingDocumentEnv: isMainFile,
      // Labels, refs and bibliography live across files — a single buffer can't
      // resolve them, so these produce false positives in multi-file projects.
      checkMissingReferences: !isMultiFile,
      checkCitesWithoutBibliography: !isMultiFile,
    },
  });
  return new LanguageSupport(highlightedLatexLanguage, base.support);
}
