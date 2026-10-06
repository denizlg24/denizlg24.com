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
      updated="6 October 2026"
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
