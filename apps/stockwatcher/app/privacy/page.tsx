import type { Metadata } from "next";
import { ContactLink, LegalPage } from "@/components/marketing/legal-page";
import { legal } from "@/lib/legal";
import { runRetentionDays } from "@/lib/run-retention";

export const metadata: Metadata = {
  title: "Privacy · Stockwatcher",
  description: "What Stockwatcher stores, who processes it, and your rights.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      current="privacy"
      title="Privacy"
      lead="What Stockwatcher keeps about you, why, who else handles it, and how to have it removed."
    >
      <h2>Who is responsible</h2>
      <p>
        Stockwatcher is operated by {legal.operator}, {legal.country}, the
        controller of the personal data described here. Questions and requests:{" "}
        <ContactLink />.
      </p>

      <h2>What we store</h2>
      <ul>
        <li>
          <strong>Account.</strong> Your name, email address and account id,
          received from Deniz Cloud sign-in when you sign in. We never see your
          password.
        </li>
        <li>
          <strong>Workspace.</strong> Watchlists, portfolios and trades you
          enter, alerts, notes, saved preferences and the facts the assistant
          remembers for you. You can edit or delete each of these in the app.
        </li>
        <li>
          <strong>Conversations.</strong> Your assistant threads, kept until you
          delete them. Documents you upload are stored as extracted text so the
          assistant can cite them, until you delete them.
        </li>
        <li>
          <strong>Connections.</strong> Interactive Brokers Flex credentials and
          alert destinations (phone number, chat ids, webhook addresses) are
          stored encrypted and used only to sync your positions and deliver your
          alerts.
        </li>
        <li>
          <strong>Billing.</strong> Your credit balance and a ledger of grants,
          purchases and usage. Card details never reach us.
        </li>
        <li>
          <strong>Operations.</strong> For each assistant request we keep a
          record of timing, model, token use, tools called and errors, with a
          copy of your question and the reply in which email addresses, phone
          numbers, account and card numbers, tokens, addresses and your name are
          removed. These records are deleted after {runRetentionDays} days, or
          with the thread they belong to. They are read only to fix problems and
          prevent abuse.
        </li>
        <li>
          <strong>Enquiries.</strong> What you send through the desk enquiry
          form, to reply to you.
        </li>
      </ul>

      <h2>Why</h2>
      <p>
        To provide the service you signed up for (contract), to keep it working,
        secure and free of abuse (legitimate interest), and to keep billing and
        tax records (legal obligation). We do not sell your data, show
        advertising, or use your data to train models.
      </p>

      <h2>Who else processes it</h2>
      <ul>
        <li>
          <strong>Vercel AI Gateway</strong> and the model provider it routes to
          receive your assistant messages and the workspace context needed to
          answer them.
        </li>
        <li>
          <strong>Polar</strong> (merchant of record) handles checkout, payment,
          receipts and tax for credit packs.
        </li>
        <li>
          <strong>Resend</strong> sends alert and account emails.
        </li>
        <li>
          Channels you connect — Telegram, Discord, Slack, ntfy, WhatsApp via
          CallMeBot, or your own webhook — receive the alerts you send to them.
        </li>
        <li>
          <strong>Interactive Brokers</strong>, when you connect it, is asked
          for your statements with the credentials you provide.
        </li>
        <li>
          Market data providers receive the symbols being looked up, never who
          looked them up.
        </li>
      </ul>
      <p>
        The application and its database run on servers operated by{" "}
        {legal.operator}. Some processors above are outside the European
        Economic Area; transfers rely on their standard contractual clauses.
      </p>

      <h2>Shared reports</h2>
      <p>
        A report you share gets an unguessable public link. Anyone with the link
        can read it until you stop sharing it.
      </p>

      <h2>Cookies</h2>
      <p>
        One session cookie keeps you signed in. There are no analytics or
        advertising cookies.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask for a copy of your data, its correction or deletion,
        restrict or object to its processing, or take it elsewhere. Email{" "}
        <ContactLink /> from the address on your account; we answer within one
        month. Deleting your account removes your workspace, threads, documents,
        connections and operational records; billing records are kept as long as
        tax law requires. You can also complain to the Comissão Nacional de
        Proteção de Dados (cnpd.pt).
      </p>

      <h2>Changes</h2>
      <p>
        The date above changes whenever this page does. Material changes are
        announced by email before they apply.
      </p>
    </LegalPage>
  );
}
