import Link from "next/link";
import { LegalPage, LegalSection } from "@/app/_landing/legal-page";
import { pageMetadata } from "@/app/metadata";
import { DeleteAccountForm } from "./delete-account-form";

export const metadata = pageMetadata(
  "Delete your account",
  "Permanently delete your Macros account and its data.",
  "/account/delete",
);

export default function DeleteAccountPage() {
  return (
    <LegalPage
      title="Delete your account"
      updated="6 October 2026"
      intro={
        <p>
          Deleting your Macros account removes your food log, foods, recipes,
          weigh-ins, progress photos, habits, settings, and sessions. This
          cannot be undone.
        </p>
      }
    >
      <LegalSection title="Before you delete">
        <p>
          If you want a copy of your statistics, export them in the app under
          Progress › Statistics first. You can also delete your account in the
          app under More › Settings › Delete Account.
        </p>
      </LegalSection>
      <LegalSection title="Confirm deletion">
        <DeleteAccountForm />
      </LegalSection>
      <LegalSection title="More information">
        <p>
          Read the <Link href="/privacy">privacy policy</Link> for details, or
          <Link href="/support"> contact support</Link> if you cannot sign in.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
