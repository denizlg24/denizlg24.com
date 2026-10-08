import Link from "next/link";
import { LegalPage, LegalSection } from "@/app/_landing/legal-page";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Privacy policy",
  "What Macros stores, how Apple Health works, and how to delete your data.",
  "/privacy",
);

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      updated="8 October 2026"
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
            Resend delivers account emails. On iPhone, Apple delivers push
            notifications when you enable them.
          </li>
          <li>
            Your data is kept while your account exists. You can delete the
            account in the app or{" "}
            <Link href="/account/delete">on this site</Link>.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="The iPhone beta">
        <p>
          The TestFlight sign-up on the download page sends the email address
          and any name you enter to Apple, which adds you as a tester and emails
          the invite. Macros doesn’t keep a copy. Apple’s TestFlight terms cover
          what it does with tester details, and you can leave the beta from the
          TestFlight app.
        </p>
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

      <LegalSection title="Shared foods, reports and hiding">
        <p>
          When a food you create is added to the shared database, Macros keeps a
          private record that your account added it, so a report about it can be
          acted on. Other people never see who added a food; the moderator sees
          a code in place of your name, and looking up the email behind it is
          logged.
        </p>
        <p>
          If you report a food, Macros stores the food, the reason, any note you
          write and when you sent it. Notes are shown to the moderator without
          your name. If you hide a contributor, Macros stores that you did and
          the name of the food you did it from. When a food is removed or an
          account is restricted, the action and the moderator’s note are kept in
          a moderation log.
        </p>
        <p>
          Deleting your account deletes your reports, the people you hid, and
          the record that you added any shared food. Foods you shared stay in
          the database, with nothing that links them to you.
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
          the photo is sent to an image-reading service the developer runs. That
          service sends the image through Vercel AI Gateway to an AI model
          provider to extract the values. Macros doesn’t save the label photo.
        </p>
      </LegalSection>

      <LegalSection title="Apple Health">
        <p>
          With your permission, the iPhone app reads weight, body fat, steps and
          active energy from Apple Health. It sends those readings to your
          Macros account to update your trend and energy estimate. The app can
          also write the calories and macros you log back to Apple Health.
          Health access can be changed in the app or in iPhone Settings.
        </p>
        <p>
          A separate Apple Health Shortcut can send the same kinds of readings
          using an import token. Those tokens are stored only as hashes and
          shown to you once.
        </p>
        <p>
          Macros does not use Apple Health data for advertising and does not
          send it to a third-party analytics service.
        </p>
      </LegalSection>

      <LegalSection title="Notifications">
        <p>
          If you allow push notifications on iPhone, the app sends its device
          token and the app’s push environment to the Macros server. The server
          uses Apple Push Notification service to deliver notifications. You can
          turn notifications off in the app or iPhone Settings.
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
          Account, or <Link href="/account/delete">on this website</Link>. That
          immediately deletes your account, your sessions, everything you
          logged, your own foods and recipes, and your progress photos. It can’t
          be undone.
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
          itself works. For help, <Link href="/support">contact support</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
