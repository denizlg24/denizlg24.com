import type { ReactNode } from "react";
import {
  MarketingFooter,
  MarketingNav,
  MarketingPage,
} from "@/components/marketing/shell";
import { authReady, currentUser } from "@/lib/auth";
import { legal } from "@/lib/legal";

export async function LegalPage({
  title,
  lead,
  current,
  children,
}: {
  title: string;
  lead: string;
  current: "privacy" | "terms";
  children: ReactNode;
}) {
  const user = await currentUser();
  return (
    <MarketingPage>
      <MarketingNav
        signIn={authReady()}
        signedIn={Boolean(user)}
        current={current}
      />
      <header className="mk-page-head" data-tone="night">
        <h1>{title}</h1>
        <p>{lead}</p>
      </header>
      <section className="mk-section legal-section" data-tone="paper">
        <article className="legal">
          <p className="legal-updated">
            Last updated <time dateTime={legal.updated}>{legal.updated}</time>
          </p>
          {children}
        </article>
      </section>
      <section className="mk-close mk-close-short" data-tone="night">
        <MarketingFooter />
      </section>
    </MarketingPage>
  );
}

export const ContactLink = () => (
  <a href={`mailto:${legal.contact}`}>{legal.contact}</a>
);
