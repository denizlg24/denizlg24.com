import type { ReactNode } from "react";
import { FileSearch, FileText, Files } from "lucide-react";

type Hit = { docId: string; name: string; page: number | null; snippet: string };

export function DocumentChip({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <p className="chat-chip-line">
      <span className="chip" title={text}>
        {icon}
        <span className="chat-truncate">{text}</span>
      </span>
    </p>
  );
}

export function DocumentList({ count }: { count: number }) {
  return (
    <DocumentChip
      icon={<Files aria-hidden />}
      text={`${count} document${count === 1 ? "" : "s"} in your library`}
    />
  );
}

export function DocumentRead({
  name,
  fromPage,
  toPage,
}: {
  name: string;
  fromPage: number | null;
  toPage: number | null;
}) {
  const pages =
    fromPage === null
      ? ""
      : fromPage === toPage
        ? ` · p.${fromPage}`
        : ` · pp.${fromPage}–${toPage}`;
  return (
    <DocumentChip icon={<FileText aria-hidden />} text={`Read “${name}”${pages}`} />
  );
}

export function DocumentHits({ query, results }: { query: string; results: Hit[] }) {
  return (
    <div className="doc-hits">
      <DocumentChip
        icon={<FileSearch aria-hidden />}
        text={`Searched documents for “${query}” · ${results.length} passage${results.length === 1 ? "" : "s"}`}
      />
      {results.length ? (
        <ul className="ruled-list flush-top doc-hit-list">
          {results.slice(0, 5).map((hit, index) => (
            <li key={`${hit.docId}-${index}`}>
              <span className="meta">
                {hit.name}
                {hit.page === null ? "" : ` · p.${hit.page}`}
              </span>
              <p>{hit.snippet.replace(/\*\*/g, "")}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
