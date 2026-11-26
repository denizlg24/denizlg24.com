import Link from "next/link";
import { BrandGlyph } from "@/components/brand-glyph";

export default function NotFound() {
  return (
    <main className="doc-page">
      <article className="doc doc-missing">
        <header className="doc-masthead">
          <span className="brand">
            <span className="brand-mark" aria-hidden>
              <BrandGlyph size={16} />
            </span>
            <span>Stockwatcher</span>
          </span>
        </header>
        <header className="doc-header">
          <h1>This page isn’t available.</h1>
          <p className="doc-standfirst">
            The link may have been revoked by its owner, or the address is
            mistyped. Ask the person who shared it for a new link.
          </p>
        </header>
        <p className="doc-missing-action">
          <Link href="/">Go to Stockwatcher</Link>
        </p>
      </article>
    </main>
  );
}
