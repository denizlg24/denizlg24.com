import type { EtfHolding } from "./types";

const patterns = new Map<string, RegExp>();
function tag(block: string, name: string): string | null {
  let pattern = patterns.get(name);
  if (!pattern) {
    pattern = new RegExp(
      `<(?:\\w+:)?${name}>\\s*([^<]*?)\\s*</(?:\\w+:)?${name}>`,
    );
    patterns.set(name, pattern);
  }
  const text = pattern.exec(block)?.[1];
  return text
    ? text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
    : null;
}

const finite = (text: string | null) => {
  const value = text === null ? Number.NaN : Number(text);
  return Number.isFinite(value) ? value : null;
};

const identifier = (text: string | null) =>
  text && !/^(n\/a|na|none)$/i.test(text) && !/^0+$/.test(text) ? text : null;

export type NportReport = {
  registrant: string;
  series: string | null;
  seriesId: string | null;
  reportDate: string | null;
  netAssets: number | null;
  holdingCount: number;
  holdings: EtfHolding[];
};

/** Reads one NPORT-P and keeps the `top` largest long and short lines by USD value. */
export function parseNport(xml: string, top: number): NportReport {
  const holdingsAt = xml.indexOf("<invstOrSecs");
  const head = holdingsAt >= 0 ? xml.slice(0, holdingsAt) : xml;
  const all: EtfHolding[] = [];
  for (const [, block] of xml.matchAll(
    /<(?:\w+:)?invstOrSec>([\s\S]*?)<\/(?:\w+:)?invstOrSec>/g,
  )) {
    all.push({
      name: tag(block, "name") ?? tag(block, "title") ?? "",
      title: tag(block, "title"),
      cusip: identifier(tag(block, "cusip")),
      isin: identifier(/<isin\s+value="([^"]+)"/.exec(block)?.[1] ?? null),
      ticker: null,
      assetCategory: tag(block, "assetCat"),
      country: tag(block, "invCountry"),
      shares: finite(tag(block, "balance")),
      units: tag(block, "units"),
      value: finite(tag(block, "valUSD")),
      percentOfNetAssets: finite(tag(block, "pctVal")),
    });
  }
  all.sort((a, b) => Math.abs(b.value ?? 0) - Math.abs(a.value ?? 0));
  return {
    registrant: tag(head, "regName") ?? "",
    series: tag(head, "seriesName"),
    seriesId: tag(head, "seriesId"),
    reportDate: tag(head, "repPdDate"),
    netAssets: finite(tag(head, "netAssets")),
    holdingCount: all.length,
    holdings: all.slice(0, top),
  };
}
