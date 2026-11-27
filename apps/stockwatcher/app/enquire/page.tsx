import type { Metadata } from "next";
import { EnquiryForm } from "@/components/marketing/enquiry-form";
import {
  MarketingFooter,
  MarketingNav,
  MarketingPage,
} from "@/components/marketing/shell";
import { authReady, currentUser } from "@/lib/auth";
import { interests, seatOptions } from "@/lib/enquiries";

export const metadata: Metadata = {
  title: "Desk enquiry · Stockwatcher",
  description:
    "Shared watchlists, pooled credits, broker sync for every seat and invoiced billing.",
};

const isInterest = (value: unknown): value is (typeof interests)[number] =>
  typeof value === "string" && interests.some((item) => item === value);

export default async function EnquirePage({
  searchParams,
}: PageProps<"/enquire">) {
  const [user, params] = await Promise.all([currentUser(), searchParams]);
  const requested = params.interest;
  const initialInterest = isInterest(requested) ? requested : interests[0];

  return (
    <MarketingPage>
      <MarketingNav
        signIn={authReady()}
        signedIn={Boolean(user)}
        current="enquire"
      />
      <header className="mk-page-head" data-tone="night">
        <h1>Bring Stockwatcher to your desk.</h1>
        <p>
          Shared watchlists, pooled credits, broker sync for every seat and
          invoiced billing. Tell us how the desk works and we will reply within
          two business days.
        </p>
      </header>
      <section
        className="mk-section enquiry-section"
        data-tone="paper"
        aria-label="Enquiry form"
      >
        <EnquiryForm
          interests={interests}
          seatOptions={seatOptions}
          initialInterest={initialInterest}
        />
      </section>
      <section className="mk-close mk-close-short" data-tone="night">
        <MarketingFooter />
      </section>
    </MarketingPage>
  );
}
