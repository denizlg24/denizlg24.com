import Link from "next/link";
import { LegalPage, LegalSection } from "@/app/_landing/legal-page";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Terms of use",
  "The terms for using Macros, the nutrition tracker for iPhone and Android.",
  "/terms",
);

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated="8 October 2026"
      intro={
        <p>
          These terms cover the Macros apps for iPhone and Android and the
          service behind them, built and run by one developer (
          <a
            href="https://denizlg24.com"
            className="font-medium text-foreground underline decoration-border underline-offset-4"
          >
            denizlg24.com
          </a>
          ). Creating an account means you accept them.
        </p>
      }
    >
      <LegalSection title="What Macros is">
        <p>
          Macros is a free nutrition tracker. It records what you eat and weigh,
          and calculates targets, trends and an estimate of your energy
          expenditure from that data.
        </p>
      </LegalSection>

      <LegalSection title="Not medical advice">
        <p>
          Every figure Macros shows — expenditure, targets, trends, projections,
          micronutrient comparisons — is an estimate calculated from what you
          enter and from food data that can contain mistakes. It is not medical
          or dietary advice. Talk to a doctor or dietitian before making
          significant changes, especially if you are pregnant, have a medical
          condition, or have a history of disordered eating.
        </p>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          You need a verified email address to use Macros. Keep your password to
          yourself; you are responsible for what happens under your account.
          Health-import tokens act on your behalf too, so treat them like a
          password.
        </p>
        <p>
          You can delete your account in the app under More › Settings › Delete
          Account, or <Link href="/account/delete">on this website</Link>.
          Everything in it is deleted with it; the{" "}
          <Link href="/privacy">privacy policy</Link> lists what that covers.
        </p>
      </LegalSection>

      <LegalSection title="Installing the app">
        <p>
          The iPhone app is in public beta on Apple’s TestFlight. Signing up on
          the download page asks Apple to send you an invite; beta builds can
          have bugs, and each one stops working after 90 days unless a newer one
          replaces it.
        </p>
        <p>
          The Android app is not distributed through Google Play. It is
          downloaded from this website as an APK file, which Android asks you to
          allow before it installs. Updates are installed the same way.
        </p>
      </LegalSection>

      <LegalSection title="Food data">
        <p>
          Food search draws on a shared nutrition database. When you create a
          food with a barcode, its name, brand, serving and nutrition are added
          to that database so others scanning the same barcode can find it. Your
          name and email are never attached to it. Only add products you are
          describing honestly.
        </p>
      </LegalSection>

      <LegalSection title="Shared foods: what is not allowed">
        <p>
          There is no tolerance for objectionable content or abusive behaviour.
          A food you share must describe a real product. Its name and brand must
          not contain:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            insults, slurs, harassment or hateful content about anyone, or
            sexual or violent content;
          </li>
          <li>advertising, links, or anything meant to promote something;</li>
          <li>
            personal information such as names, phone numbers or email
            addresses;
          </li>
          <li>
            deliberately false nutrition meant to mislead the people who scan
            it.
          </li>
        </ul>
        <p>
          Macros checks the text of every shared food before it is published,
          and a food that fails the check stays private to you.
        </p>
      </LegalSection>

      <LegalSection title="Reporting and hiding">
        <p>
          Any shared food can be reported from its screen in the app (the ⋯
          menu, then Report). A reported food disappears from your searches
          straight away. You can also hide every food added by the same person;
          hidden people are listed under More › Settings › Hidden Contributors,
          where you can undo it.
        </p>
        <p>
          Reports are reviewed within 24 hours. A food that breaks these terms
          is removed from the database. Its contributor can lose the ability to
          share foods, or have their account suspended, without notice. A food
          reported by several people is taken out of search until it has been
          reviewed. To report something outside the app, email{" "}
          <a href="mailto:geral@oceaninformatix.com">
            geral@oceaninformatix.com
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="Fair use">
        <p>
          Use Macros for your own tracking. Don’t try to access other people’s
          data, overload the service, use it to scrape the food database, or
          create accounts to get around a suspension.
        </p>
      </LegalSection>

      <LegalSection title="Availability">
        <p>
          Macros is run by one person on self-hosted servers. It is provided as
          it is, without guarantees of availability, and features may change as
          the app develops. The app keeps working offline and sends what you log
          once it can reach the server again.
        </p>
      </LegalSection>

      <LegalSection title="Your data">
        <p>
          What Macros stores and where it goes is described in the{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
