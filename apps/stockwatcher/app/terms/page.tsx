import type { Metadata } from "next";
import Link from "next/link";
import { ContactLink, LegalPage } from "@/components/marketing/legal-page";
import { legal } from "@/lib/legal";
import { freeMonthlyCredits } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Terms · Stockwatcher",
  description: "The terms for using Stockwatcher and buying credits.",
};

export default function TermsPage() {
  const free = freeMonthlyCredits();
  return (
    <LegalPage
      current="terms"
      title="Terms"
      lead="The agreement between you and the operator of Stockwatcher when you sign in or buy credits."
    >
      <h2>The service</h2>
      <p>
        Stockwatcher is a market research workspace operated by {legal.operator}
        , {legal.country} (<ContactLink />
        ). By creating an account or using the service you accept these terms
        and the <Link href="/privacy">privacy notice</Link>.
      </p>

      <h2>Not investment advice</h2>
      <p>
        Everything in Stockwatcher — quotes, charts, screens, reports and the
        assistant's answers — is information, not investment, legal or tax
        advice, and not a recommendation to buy or sell anything. Data can be
        delayed, incomplete or wrong, and the assistant can make mistakes. Check
        what matters against the source shown, and make your own decisions.
      </p>

      <h2>Your account</h2>
      <p>
        You need to be at least 18. Keep your sign-in secure; you are
        responsible for what happens under your account. One account per person.
      </p>

      <h2>Credits</h2>
      <ul>
        <li>
          Assistant work is paid in credits, charged at what each run cost,
          rounded up. Your balance is shown next to the assistant.
        </li>
        <li>
          Every account gets {free} free credits each calendar month (UTC). They
          do not carry over and are used before purchased credits.
        </li>
        <li>
          Purchased credit packs do not expire, cannot be transferred or
          exchanged for money, and are one-time purchases, not a subscription.
        </li>
        <li>
          Packs are sold by Polar as merchant of record, under its terms.
          Because credits are digital content available immediately, you agree
          at checkout that the 14-day withdrawal right ends once you start using
          them. Unused packs can be refunded on request within 14 days; a refund
          removes the credits it paid for.
        </li>
        <li>
          Prices may change; a change never affects credits already bought.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>
        Do not use Stockwatcher to break the law, to scrape or resell its data,
        to probe or overload it, to get around credit limits, or to generate
        content that harms others. We may suspend accounts that do. Market data
        remains subject to its providers' terms and is for your personal use.
      </p>

      <h2>Your content</h2>
      <p>
        What you enter and upload stays yours. You give us the permission needed
        to store and process it to run the service for you, and nothing more.
      </p>

      <h2>Availability and changes</h2>
      <p>
        We work to keep Stockwatcher available but do not guarantee it is
        uninterrupted or error free. Features may change. If we end the service,
        we will give at least 30 days' notice and refund unused purchased
        credits.
      </p>

      <h2>Liability</h2>
      <p>
        The service is provided as is. To the extent the law allows, we are not
        liable for trading or investment losses, or for indirect or
        consequential losses, and our total liability is limited to what you
        paid us in the twelve months before the claim. Nothing here limits
        rights you have as a consumer that cannot be limited by contract.
      </p>

      <h2>Ending</h2>
      <p>
        You can stop using Stockwatcher at any time and ask for your account to
        be deleted. We may close accounts that break these terms.
      </p>

      <h2>Law</h2>
      <p>
        These terms are governed by the law of {legal.country}, and disputes go
        to {legal.courts}, without affecting the mandatory protection of the law
        of the country where you live as a consumer. EU consumers can also use
        the online dispute resolution platform at ec.europa.eu/consumers/odr.
      </p>
    </LegalPage>
  );
}
