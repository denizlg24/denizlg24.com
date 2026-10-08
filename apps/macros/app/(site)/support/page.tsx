import Link from "next/link";
import { LegalPage, LegalSection } from "@/app/_landing/legal-page";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Support",
  "Help with Macros, account access, and your data.",
  "/support",
);

export default function SupportPage() {
  return (
    <LegalPage
      title="Support"
      updated="8 October 2026"
      intro={
        <p>
          Need help with Macros? Send an email with a short description of what
          happened and which phone you use.
        </p>
      }
    >
      <LegalSection title="Contact">
        <p>
          Email{" "}
          <a href="mailto:geral@oceaninformatix.com">
            geral@oceaninformatix.com
          </a>
          . Please leave passwords, login codes, and health records out of your
          message.
        </p>
      </LegalSection>
      <LegalSection title="Reporting a food">
        <p>
          Open the food in the app, tap ⋯ and choose Report, or Hide Foods From
          This Contributor to stop seeing anything that person added. Reports
          are reviewed within 24 hours. You can also email the address above
          with the food’s name and barcode. The{" "}
          <Link href="/terms">terms of use</Link> list what shared foods may not
          contain.
        </p>
      </LegalSection>
      <LegalSection title="Your account">
        <p>
          You can reset a forgotten password from the app’s sign-in screen. To
          permanently remove your account and its data, use the app’s Settings
          screen or the{" "}
          <Link href="/account/delete">account deletion page</Link>.
        </p>
        <p>
          The <Link href="/privacy">privacy policy</Link> explains what Macros
          stores and how deletion works.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
