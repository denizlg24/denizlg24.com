"use client";

import {
  Check,
  Copy,
  FileText,
  Link2,
  Link2Off,
  Presentation,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import useSWR from "swr";
import {
  api,
  Empty,
  Failure,
  Loading,
  PanelHeading,
} from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  previewPath,
  type ReportSummary,
  sharePath,
} from "@/lib/reports/types";
import { copyText, removeReport, reportsKey, setShared } from "./actions";

const updatedFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function Row({
  item,
  onAsk,
}: {
  item: ReportSummary;
  onAsk: (error: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const shareUrl = item.shareToken
    ? `${window.location.origin}${sharePath(item.kind, item.shareToken)}`
    : null;

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      onAsk(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    if (await copyText(url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } else onAsk("Copy failed. Open the report and copy the address instead.");
  }

  const Icon = item.kind === "deck" ? Presentation : FileText;
  return (
    <tr>
      <td>
        <span className="library-title">
          <Icon aria-hidden />
          <a href={previewPath(item.id)} target="_blank" rel="noopener">
            {item.title}
          </a>
        </span>
      </td>
      <td className="library-kind">
        {item.kind === "deck" ? "Deck" : "Report"}
      </td>
      <td className="library-updated">
        <time dateTime={item.updatedAt}>
          {updatedFormat.format(new Date(item.updatedAt))}
        </time>
      </td>
      <td className="library-state">
        {item.shared ? (
          <span className="library-shared">
            <span className="status-dot" aria-hidden /> Public link
          </span>
        ) : (
          <span className="muted">Private</span>
        )}
      </td>
      <td className="library-actions">
        {shareUrl ? (
          <>
            <Button
              variant="outline"
              size="xs"
              onClick={() => void copy(shareUrl)}
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => void run(() => setShared(item.id, false))}
              aria-label={`Stop sharing ${item.title}`}
            >
              <Link2Off aria-hidden /> Unshare
            </Button>
          </>
        ) : (
          <Button
            variant="outline"
            size="xs"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const result = await setShared(item.id, true);
                if (result.shareUrl) await copy(result.shareUrl);
              })
            }
            aria-label={`Share ${item.title}`}
          >
            <Link2 aria-hidden /> Share
          </Button>
        )}
        {confirming ? (
          <Button
            variant="destructive"
            size="xs"
            disabled={busy}
            onClick={() => void run(() => removeReport(item.id))}
            onBlur={() => setConfirming(false)}
            autoFocus
          >
            Confirm delete
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => setConfirming(true)}
            aria-label={`Delete ${item.title}`}
            title="Delete"
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </td>
    </tr>
  );
}

export function ReportsLibrary({
  onAsk,
}: {
  onAsk?: (prompt: string) => void;
}) {
  const { data, error, isLoading, mutate } = useSWR<ReportSummary[]>(
    reportsKey,
    api,
  );
  const [problem, setProblem] = useState("");
  const shared = data?.filter((item) => item.shared).length ?? 0;
  return (
    <section className="section reports-library">
      <PanelHeading
        title="Library"
        subtitle={
          data
            ? `${data.length} ${data.length === 1 ? "document" : "documents"} · ${shared} shared by public link`
            : "Reports and decks written by the assistant"
        }
      />
      {problem ? (
        <p className="failure" role="alert">
          {problem}
          <Button variant="ghost" size="xs" onClick={() => setProblem("")}>
            Dismiss
          </Button>
        </p>
      ) : null}
      {isLoading ? <Loading message="Loading reports" /> : null}
      <Failure error={error} retry={() => mutate()} />
      {data && !data.length ? (
        <Empty title="No reports or decks yet.">
          <p>
            Ask the assistant to write one, for example “Write up how my book
            did this quarter for the investment committee” or “Make a 6-slide
            deck on NVDA vs AMD year to date”.
          </p>
          {onAsk ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onAsk(
                  "Write a short report on how the Magnificent Seven have performed year to date versus the S&P 500, with a performance chart.",
                )
              }
            >
              Try a sample report
            </Button>
          ) : null}
        </Empty>
      ) : null}
      {data?.length ? (
        <div className="library-scroll">
          <table className="data-table library-table">
            <thead>
              <tr>
                <th scope="col">Title</th>
                <th scope="col" className="library-kind">
                  Kind
                </th>
                <th scope="col" className="library-updated">
                  Updated
                </th>
                <th scope="col">Sharing</th>
                <th scope="col" className="library-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((item) => (
                <Row key={item.id} item={item} onAsk={setProblem} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <footer className="section-foot">
        <span>Public links are read-only and can be revoked at any time</span>
        <span>Market data is frozen when a document is created</span>
      </footer>
    </section>
  );
}
