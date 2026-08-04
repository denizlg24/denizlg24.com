export const revalidate = 15552000; // Revalidate every 6 months

import type { Metadata } from "next";

const TITLE = "Authenticator Extension Privacy Policy";
const DESCRIPTION =
  "What the denizlg24 Authenticator browser extension stores, where it sends data, and what it never collects.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: `${TITLE} | Deniz Lopes Güneş`,
    description: DESCRIPTION,
    url: "https://denizlg24.com/extension-privacy",
    type: "website",
    locale: "en_US",
    siteName: "Deniz Lopes Güneş Portfolio",
  },
  twitter: {
    card: "summary_large_image",
    title: `${TITLE} | Deniz Lopes Güneş`,
    description: DESCRIPTION,
  },
};

export default function ExtensionPrivacyPage() {
  return (
    <main className="max-w-4xl mx-auto px-4">
      <h1 className="text-4xl font-bold mb-2 font-calistoga text-center">
        authenticator extension privacy.
      </h1>
      <article className="max-w-none mt-16">
        <p className="text-muted-foreground mb-8">Last Updated: August 2026</p>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">What it is</h2>
          <p className="text-foreground/80 leading-relaxed">
            The denizlg24 Authenticator is a browser extension that generates
            time-based one-time passwords (TOTP) from secrets held in the
            authenticator section of denizlg24.com. It is a single-user tool: it
            only ever talks to the server you configure with your own API key.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">What it stores</h2>
          <p className="text-foreground/80 leading-relaxed mb-4">
            Everything the extension keeps lives on your own device, in the
            browser&apos;s extension storage. Nothing is stored anywhere else,
            and there is no account, no analytics and no telemetry.
          </p>
          <ul className="text-foreground/80 leading-relaxed list-disc pl-6 space-y-2">
            <li>
              <strong>TOTP secrets, account labels and your API key</strong> —
              encrypted with AES-256-GCM under a key derived from your
              passphrase (PBKDF2-SHA256, 600,000 iterations). The passphrase is
              never stored; without it the stored data cannot be read, including
              by the author.
            </li>
            <li>
              <strong>
                The server address, timing preferences and the time of the last
                sync
              </strong>{" "}
              — stored unencrypted, because none of it is sensitive.
            </li>
            <li>
              <strong>The unlocked encryption key</strong> — held in memory only
              (<code>storage.session</code>) while the vault is unlocked, and
              discarded when the browser closes or the auto-lock timer fires.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">What it sends</h2>
          <p className="text-foreground/80 leading-relaxed">
            The extension makes network requests to exactly one place: the API
            base URL you enter during setup, which defaults to denizlg24.com.
            Those requests carry your API key and the authenticator accounts
            being synchronised. No data is sent to any third party, no data is
            sold or transferred for advertising, and no code is loaded from a
            remote source.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Permissions</h2>
          <ul className="text-foreground/80 leading-relaxed list-disc pl-6 space-y-2">
            <li>
              <strong>storage</strong> — to keep the encrypted vault and
              settings on your device.
            </li>
            <li>
              <strong>alarms</strong> — to run the periodic sync and the idle
              auto-lock.
            </li>
            <li>
              <strong>clipboardWrite</strong> — to copy a code when you click
              it.
            </li>
            <li>
              <strong>access to denizlg24.com</strong> — to reach the
              authenticator API. Any other address you configure is requested at
              that moment and can be declined.
            </li>
          </ul>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Removing your data</h2>
          <p className="text-foreground/80 leading-relaxed">
            Uninstalling the extension deletes its storage. The options page
            also has an erase action that clears the vault and all settings
            immediately.
          </p>
        </section>

        <section className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Contact</h2>
          <p className="text-foreground/80 leading-relaxed">
            Questions about this policy: denizlg24@gmail.com.
          </p>
        </section>
      </article>
    </main>
  );
}
