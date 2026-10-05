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
      updated="29 September 2026"
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
          You can delete your account at any time in the app, under More ›
          Settings › Delete Account. Everything in it is deleted with it; the{" "}
          <Link href="/privacy">privacy policy</Link> lists what that covers.
        </p>
      </LegalSection>

      <LegalSection title="Installing the app">
        <p>
          The iPhone app is not distributed through the App Store. It installs
          through SideStore, a third-party tool that signs apps with your own
          Apple ID and is not part of Macros. With a free Apple ID, the app has
          to be re-signed every 7 days; if that lapses, the app won’t open until
          SideStore refreshes it.
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
          to that database so others scanning the same barcode can find it. Only
          add products you are describing honestly.
        </p>
      </LegalSection>

      <LegalSection title="Fair use">
        <p>
          Use Macros for your own tracking. Don’t try to access other people’s
          data, overload the service, or use it to scrape the food database.
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
