import Link from "next/link";
import { LegalPage, LegalSection } from "@/app/_landing/legal-page";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Privacy policy",
  "What Macros stores, where it goes, and what it never collects.",
  "/privacy",
);

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="29 September 2026"
      intro={
        <p>
          Macros is a nutrition tracker built and run by one developer (
          <a
            href="https://denizlg24.com"
            className="font-medium text-foreground underline decoration-border underline-offset-4"
          >
            denizlg24.com
          </a>
          ). This page says what the app stores, where it goes, and what it
          doesn’t do.
        </p>
      }
    >
      <LegalSection title="The short version">
        <ul>
          <li>No advertising, and no third-party analytics or tracking.</li>
          <li>
            What you log is stored on servers the developer operates, not handed
            to an ad network or a data broker.
          </li>
          <li>
            The only outside service that receives anything is the one that
            sends account emails, and it only gets your email address.
          </li>
          <li>
            Your data is kept while your account exists. Deleting your account
            in the app deletes it.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Your account">
        <p>
          You sign up with a name, an email address and a password. The password
          is stored only as a hash. Your email address has to be verified before
          the account can be used.
        </p>
        <p>
          Signing in creates a session that lasts up to 90 days. Each session
          records the IP address and the device’s user agent it was created
          from.
        </p>
      </LegalSection>

      <LegalSection title="What you log">
        <p>
          Everything you enter is stored with your account in a database on
          servers the developer operates. That includes:
        </p>
        <ul>
          <li>
            Your profile: height, birth date, sex, activity level, time zone,
            units and goals, which Macros uses to estimate your targets.
          </li>
          <li>
            Food entries, your own foods, recipes, saved meals, day notes and
            your shopping list.
          </li>
          <li>
            Weigh-ins, body-fat readings, body measurements, steps, active
            energy, hydration and habits.
          </li>
          <li>
            The nutrition targets, check-ins and expenditure estimates Macros
            calculates from all of the above.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Progress photos">
        <p>
          Photos you add to a weigh-in are uploaded to private object storage
          run by the developer, not into the database. The app only reaches them
          through signed links that expire after 15 minutes. Deleting a photo in
          the app deletes the file from storage.
        </p>
      </LegalSection>

      <LegalSection title="Where your data goes">
        <p>
          <strong>Account emails.</strong> Verification and password-reset
          emails are sent through Resend, an email delivery service, which
          receives your email address and the message.
        </p>
        <p>
          <strong>Food search.</strong> Searches and barcode lookups are
          forwarded from the Macros server to the nutrition database it uses,
          which the developer also runs. They are sent with a service key, not
          with your account details. If you create a food with a barcode, that
          product’s name, brand, serving and nutrition are added to the shared
          database so the barcode finds it next time — again without your
          account attached.
        </p>
        <p>
          <strong>Label photos.</strong> When you photograph a nutrition label,
          the photo is sent to an image-reading service the developer runs,
          which extracts the values. It isn’t passed to any third party, and
          Macros doesn’t keep the photo.
        </p>
      </LegalSection>

      <LegalSection title="Apple Health">
        <p>
          Macros doesn’t read Apple Health directly. If you set up the Shortcut
          described in the app, the Shortcut sends the weight, body fat, steps
          and active energy you choose to Macros using an import token. Tokens
          are stored only as hashes and are shown to you once.
        </p>
      </LegalSection>

      <LegalSection title="On your phone">
        <p>
          The app keeps your sign-in in the phone’s secure storage (the iOS
          Keychain, or the Android Keystore) and a copy of your recent data on
          the phone, so it opens quickly and keeps working offline. Entries you
          make offline are held on the phone until they can be sent.
        </p>
      </LegalSection>

      <LegalSection title="This website">
        <p>
          This site has no analytics, advertising or tracking scripts, and sets
          no tracking cookies.
        </p>
      </LegalSection>

      <LegalSection title="Keeping and deleting your data">
        <p>
          Everything described here is kept for as long as your account exists.
        </p>
        <p>
          You can delete your account in the app under More › Settings › Delete
          Account. That immediately deletes your account, your sessions,
          everything you logged, your own foods and recipes, and your progress
          photos. It can’t be undone.
        </p>
        <p>
          Products you added with a barcode stay in the shared nutrition
          database, because they never had your account attached.
        </p>
      </LegalSection>

      <LegalSection title="Your control">
        <p>
          You can edit or delete individual food entries, weigh-ins, photos,
          recipes and your own foods at any time in the app, and export your
          statistics as CSV or JSON from Progress.
        </p>
        <p>
          The <Link href="/terms">terms of use</Link> cover how the service
          itself works.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
