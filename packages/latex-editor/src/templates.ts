import type { LatexProject, LatexProjectEntry } from "./types";

export type LatexProjectTemplateId =
  | "ieee-conference"
  | "springer-lncs"
  | "acm-sigconf"
  | "elsevier-article"
  | "blank-article"
  | "thesis"
  | "letter";

export interface LatexProjectTemplate {
  id: LatexProjectTemplateId;
  name: string;
  description: string;
  category: "Publisher" | "Document";
}

export const LATEX_PROJECT_TEMPLATES: LatexProjectTemplate[] = [
  {
    id: "ieee-conference",
    name: "IEEE Conference",
    description:
      "IEEEtran conference paper with abstract, keywords, and IEEE bibliography style.",
    category: "Publisher",
  },
  {
    id: "springer-lncs",
    name: "Springer LNCS",
    description:
      "Lecture Notes in Computer Science proceedings format using the llncs class.",
    category: "Publisher",
  },
  {
    id: "acm-sigconf",
    name: "ACM Proceedings",
    description:
      "Review-ready acmart sigconf manuscript for ACM conference proceedings.",
    category: "Publisher",
  },
  {
    id: "elsevier-article",
    name: "Elsevier Article",
    description:
      "Preprint manuscript using Elsevier's elsarticle document class.",
    category: "Publisher",
  },
  {
    id: "blank-article",
    name: "Blank Article",
    description:
      "A minimal standard LaTeX article without publisher-specific formatting.",
    category: "Document",
  },
  {
    id: "thesis",
    name: "Thesis",
    description:
      "A multi-file report with an introductory chapter and bibliography.",
    category: "Document",
  },
  {
    id: "letter",
    name: "Letter",
    description:
      "A formal letter with sender, recipient, opening, and signature.",
    category: "Document",
  },
];

const IEEE_CONFERENCE = String.raw`\documentclass[conference]{IEEEtran}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}

\title{Paper Title}
\author{\IEEEauthorblockN{Author Name}
\IEEEauthorblockA{Department or Institution\\
City, Country\\
author@example.com}}

\begin{document}
\maketitle

\begin{abstract}
Summarize the problem, method, principal result, and contribution.
\end{abstract}

\begin{IEEEkeywords}
keyword one, keyword two, keyword three
\end{IEEEkeywords}

\section{Introduction}
Introduce the problem and state the contribution.

\section{Method}
Describe the proposed approach.

\section{Results}
Report the evaluation and findings.

\section{Conclusion}
Summarize the findings and limitations.

\bibliographystyle{IEEEtran}
\bibliography{references}
\end{document}
`;

const SPRINGER_LNCS = String.raw`\documentclass[runningheads]{llncs}
\usepackage[T1]{fontenc}
\usepackage{graphicx}
\usepackage{booktabs}

\title{Paper Title}
\titlerunning{Short Paper Title}
\author{First Author\inst{1} \and Second Author\inst{2}}
\authorrunning{F. Author et al.}
\institute{First Institution, City, Country\\
\email{author@example.com} \and
Second Institution, City, Country}

\begin{document}
\maketitle

\begin{abstract}
Summarize the motivation, method, main result, and contribution.
\keywords{First keyword \and Second keyword \and Third keyword}
\end{abstract}

\section{Introduction}
Introduce the problem and contributions.

\section{Method}
Describe the proposed approach.

\section{Evaluation}
Present the experimental setup and results.

\section{Conclusion}
Summarize the findings and limitations.

\bibliographystyle{splncs04}
\bibliography{references}
\end{document}
`;

const ACM_SIGCONF = String.raw`\documentclass[sigconf,review,anonymous]{acmart}

\AtBeginDocument{\providecommand\BibTeX{{Bib\TeX}}}
\setcopyright{none}
\settopmatter{printacmref=false}
\renewcommand\footnotetextcopyrightpermission[1]{}

\title{Paper Title}

\begin{document}

\begin{abstract}
Summarize the problem, approach, results, and contribution.
\end{abstract}

\keywords{keyword one, keyword two, keyword three}
\maketitle

\section{Introduction}
Introduce the problem and contributions.

\section{Approach}
Describe the proposed method.

\section{Evaluation}
Present the experiments and results.

\section{Conclusion}
Summarize the findings and limitations.

\bibliographystyle{ACM-Reference-Format}
\bibliography{references}
\end{document}
`;

const ELSEVIER_ARTICLE = String.raw`\documentclass[preprint,12pt]{elsarticle}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}

\journal{Journal Name}

\begin{document}
\begin{frontmatter}

\title{Article Title}
\author[aff1]{Author Name}
\affiliation[aff1]{organization={Institution},
  city={City},
  country={Country}}

\begin{abstract}
Summarize the problem, method, principal result, and contribution.
\end{abstract}

\begin{keyword}
keyword one \sep keyword two \sep keyword three
\end{keyword}
\end{frontmatter}

\section{Introduction}
Introduce the problem and contributions.

\section{Methods}
Describe the study design and analysis.

\section{Results}
Report the findings.

\section{Discussion}
Interpret the evidence and limitations.

\section{Conclusion}
Summarize the contribution and next steps.

\bibliographystyle{elsarticle-num}
\bibliography{references}
\end{document}
`;

const BLANK_ARTICLE = String.raw`\documentclass[11pt]{article}
\usepackage[margin=1in]{geometry}
\usepackage[T1]{fontenc}
\usepackage{microtype}

\title{Article Title}
\author{Author Name}
\date{\today}

\begin{document}
\maketitle

Start writing here.

\end{document}
`;

const THESIS_MAIN = String.raw`\documentclass[12pt]{report}
\usepackage[margin=1in]{geometry}
\usepackage[T1]{fontenc}
\usepackage{microtype}
\usepackage{amsmath,amssymb,graphicx,booktabs}
\usepackage[hidelinks]{hyperref}

\title{Thesis Title}
\author{Author Name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Summarize the research question, method, findings, and contribution.
\end{abstract}

\tableofcontents
\input{chapters/introduction}

\bibliographystyle{plain}
\bibliography{references}
\end{document}
`;

const LETTER = String.raw`\documentclass[11pt]{letter}
\usepackage[margin=1in]{geometry}
\usepackage[T1]{fontenc}

\signature{Your Name}
\address{Street Address \\ City, Postal Code \\ author@example.com}

\begin{document}
\begin{letter}{Recipient Name \\ Organization \\ Street Address}
\opening{Dear Recipient,}

Write the letter here.

\closing{Sincerely,}
\end{letter}
\end{document}
`;

const REFERENCES = `@article{example2026,
  author  = {Author, Example},
  title   = {Example Research Article},
  journal = {Journal Name},
  year    = {2026}
}
`;

function file(path: string, content: string): LatexProjectEntry {
  return {
    id: crypto.randomUUID(),
    path,
    kind: "file",
    encoding: "utf8",
    content,
  };
}

const PUBLISHER_SOURCES: Partial<Record<LatexProjectTemplateId, string>> = {
  "ieee-conference": IEEE_CONFERENCE,
  "springer-lncs": SPRINGER_LNCS,
  "acm-sigconf": ACM_SIGCONF,
  "elsevier-article": ELSEVIER_ARTICLE,
};

export function createLatexProjectFromTemplate(
  templateId: LatexProjectTemplateId,
  name: string,
): LatexProject {
  const publisherSource = PUBLISHER_SOURCES[templateId];
  let entries: LatexProjectEntry[];

  if (publisherSource) {
    entries = [
      file("main.tex", publisherSource),
      file("references.bib", REFERENCES),
    ];
  } else if (templateId === "thesis") {
    entries = [
      file("main.tex", THESIS_MAIN),
      { id: crypto.randomUUID(), path: "chapters", kind: "folder" },
      file(
        "chapters/introduction.tex",
        String.raw`\chapter{Introduction}
Introduce the research problem, questions, and contributions.
`,
      ),
      file("references.bib", REFERENCES),
    ];
  } else if (templateId === "letter") {
    entries = [file("main.tex", LETTER)];
  } else {
    entries = [file("main.tex", BLANK_ARTICLE)];
  }

  return { version: 1, name, mainFile: "main.tex", entries };
}
