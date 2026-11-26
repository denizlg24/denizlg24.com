import { Info, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { asOfLabel } from "@/lib/reports/format";
import type { Callout, Report } from "@/lib/reports/types";
import { disclaimer, Masthead } from "./brand";
import { ChartView } from "./chart";
import { DocTable } from "./doc-table";
import { ReportMarkdown } from "./markdown";
import { chartSources, latestAsOf } from "./sources";

const calloutMeta = {
  note: { label: "Note", Icon: Info },
  positive: { label: "Upside", Icon: TrendingUp },
  negative: { label: "Downside", Icon: TrendingDown },
  risk: { label: "Risk", Icon: ShieldAlert },
} as const;

function CalloutBlock({ callout }: { callout: Callout }) {
  const { label, Icon } = calloutMeta[callout.tone];
  return (
    <aside className="doc-callout" data-tone={callout.tone}>
      <p className="doc-callout-label">
        <Icon aria-hidden />
        {callout.title ?? label}
      </p>
      <p>{callout.text}</p>
    </aside>
  );
}

export function ReportView({
  doc,
  label = "Shared report",
}: {
  doc: Report;
  label?: string;
}) {
  const charts = doc.sections.flatMap((section) =>
    section.chart ? [section.chart] : [],
  );
  const asOf = latestAsOf(charts);
  const sources = chartSources(charts, doc.sources);
  return (
    <article className="doc">
      <Masthead label={label} date={doc.date} />
      <header className="doc-header">
        <h1>{doc.title}</h1>
        {doc.subtitle ? <p className="doc-standfirst">{doc.subtitle}</p> : null}
        <p className="doc-byline">
          {doc.author ? <span>{doc.author}</span> : null}
          {asOf ? <span>Data as of {asOfLabel(asOf)}</span> : null}
        </p>
      </header>
      {doc.sections.map((section, i) => (
        <section className="doc-section" key={`${i}-${section.heading}`}>
          <h2>{section.heading}</h2>
          {section.markdown ? <ReportMarkdown text={section.markdown} /> : null}
          {section.chart ? <ChartView chart={section.chart} /> : null}
          {section.table ? <DocTable table={section.table} /> : null}
          {section.callout ? <CalloutBlock callout={section.callout} /> : null}
        </section>
      ))}
      <footer className="doc-foot">
        {sources.length ? (
          <div className="doc-sources">
            <h2>Sources</h2>
            <ol>
              {sources.map((source) => (
                <li key={source}>{source}</li>
              ))}
            </ol>
          </div>
        ) : null}
        <p className="doc-disclaimer">{disclaimer}</p>
        <p className="doc-colophon">
          <span>Prepared with Stockwatcher</span>
          <span>Times in UTC</span>
        </p>
      </footer>
    </article>
  );
}
