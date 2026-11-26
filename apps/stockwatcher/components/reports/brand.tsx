import { BrandGlyph } from "@/components/brand-glyph";
import { editionDate } from "@/lib/reports/format";

export function Masthead({ label, date }: { label: string; date: string }) {
  return (
    <header className="doc-masthead">
      <span className="brand">
        <span className="brand-mark" aria-hidden>
          <BrandGlyph size={16} />
        </span>
        <span>Stockwatcher</span>
      </span>
      <p>
        <span className="doc-masthead-label">{label}</span>
        <time dateTime={date}>{editionDate(date)}</time>
      </p>
    </header>
  );
}

export const disclaimer =
  "For information only. Not investment advice or a recommendation to buy or sell any security. Figures may be delayed; check before acting.";
