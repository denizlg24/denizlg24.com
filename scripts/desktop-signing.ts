/**
 * Turns the Developer ID Application certificate into the `desktop-release`
 * environment secrets `release-desktop.yml` signs and notarizes with.
 *
 *   bun scripts/desktop-signing.ts csr       # key + CSR, once
 *   bun scripts/desktop-signing.ts secrets   # after the .cer is downloaded
 *
 * Apple lets only the Account Holder create a Developer ID certificate — an
 * App Store Connect key gets 403 — so the CSR is uploaded by hand at
 * developer.apple.com → Certificates → "+" → Developer ID Application (G2 Sub-CA),
 * and the downloaded certificate saved as `developer-id.cer` next to the key.
 *
 * The private key never leaves `~/.config/denizlg24-desktop-signing`; the
 * notarization key is the App Store Connect key in `.env.ios`.
 */
import { X509Certificate } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

const DIR = join(homedir(), ".config", "denizlg24-desktop-signing");
const KEY = join(DIR, "developer-id.key");
const CSR = join(DIR, "developer-id.csr");
const CER = join(DIR, "developer-id.cer");
const P12 = join(DIR, "developer-id.p12");
const ENVIRONMENT = "desktop-release";
// Bun loads the repo's .env, whose GITHUB_TOKEN is narrower than the owner's
// gh login and cannot write environment secrets.
const ghEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => key !== "GITHUB_TOKEN" && key !== "GH_TOKEN",
  ),
);
const REPO = "denizlg24/denizlg24.com";

function readEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  const pattern = /^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/gm;
  for (const match of readFileSync(path, "utf8").matchAll(pattern)) {
    const [, name, quoted, bare] = match;
    if (name) values[name] = quoted ?? bare ?? "";
  }
  return values;
}

async function createCsr() {
  await $`mkdir -p ${DIR} && chmod 700 ${DIR}`;
  if (!existsSync(KEY)) {
    await $`openssl genrsa -out ${KEY} 2048`.quiet();
    await $`chmod 600 ${KEY}`;
  }
  await $`openssl req -new -key ${KEY} -out ${CSR} -subj ${"/emailAddress=denizlg24@gmail.com/CN=Deniz Gunes/C=DK"}`;
  console.log(`CSR: ${CSR}`);
  console.log(
    "Upload it as a Developer ID Application (G2 Sub-CA) certificate and save the download as",
    CER,
  );
}

async function setSecret(name: string, value: string) {
  await $`gh secret set ${name} --env ${ENVIRONMENT} --repo ${REPO} < ${Buffer.from(value)}`
    .env(ghEnv)
    .quiet();
  console.log(`set ${name}`);
}

async function uploadSecrets() {
  if (!existsSync(CER)) throw new Error(`Missing ${CER}`);
  const certificate = new X509Certificate(readFileSync(CER));
  const identity = certificate.subject
    .split("\n")
    .find((line) => line.startsWith("CN="))
    ?.slice(3);
  if (!identity?.startsWith("Developer ID Application:")) {
    throw new Error(`Not a Developer ID Application certificate: ${identity}`);
  }
  if (new Date(certificate.validTo) < new Date()) {
    throw new Error(`Certificate expired ${certificate.validTo}`);
  }

  const password = crypto.randomUUID().replaceAll("-", "");
  const pem = join(DIR, "developer-id.pem");
  await $`openssl x509 -inform DER -in ${CER} -out ${pem}`;
  // Legacy algorithms: `security import` on the runner refuses OpenSSL 3's
  // AES-encrypted PKCS#12 with a misleading "wrong password".
  await $`openssl pkcs12 -export -legacy -inkey ${KEY} -in ${pem} -name ${identity} -out ${P12} -passout env:P12_PASSWORD`.env(
    { ...process.env, P12_PASSWORD: password },
  );
  await $`chmod 600 ${P12}`;

  const ios = readEnvFile(join(import.meta.dir, "..", ".env.ios"));
  for (const name of [
    "APPLE_ASC_KEY_ID",
    "APPLE_ASC_ISSUER_ID",
    "APPLE_ASC_PRIVATE_KEY",
  ]) {
    if (!ios[name]) throw new Error(`.env.ios has no ${name}`);
  }

  // A fine-grained token may write environment secrets yet not create the
  // environment itself, so that one step is left to the settings page.
  const environment = await $`gh api repos/${REPO}/environments/${ENVIRONMENT}`
    .env(ghEnv)
    .quiet()
    .nothrow();
  if (environment.exitCode !== 0) {
    throw new Error(
      `Create the "${ENVIRONMENT}" environment first (no protection rules): https://github.com/${REPO}/settings/environments/new`,
    );
  }
  await setSecret(
    "APPLE_DEVELOPER_ID_P12",
    readFileSync(P12).toString("base64"),
  );
  await setSecret("APPLE_DEVELOPER_ID_P12_PASSWORD", password);
  await setSecret("APPLE_DEVELOPER_ID_IDENTITY", identity);
  await setSecret("APPLE_ASC_KEY_ID", ios.APPLE_ASC_KEY_ID ?? "");
  await setSecret("APPLE_ASC_ISSUER_ID", ios.APPLE_ASC_ISSUER_ID ?? "");
  await setSecret("APPLE_ASC_PRIVATE_KEY", ios.APPLE_ASC_PRIVATE_KEY ?? "");
  writeFileSync(join(DIR, "identity.txt"), `${identity}\n`);
  console.log(`Signing identity: ${identity}`);
}

const command = process.argv[2];
if (command === "csr") await createCsr();
else if (command === "secrets") await uploadSecrets();
else {
  console.error("usage: bun scripts/desktop-signing.ts csr|secrets");
  process.exit(1);
}
