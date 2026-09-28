/**
 * Describes one built IPA for the SideStore source. Runs on the macOS build
 * runner: `plutil` reads the compiled (binary) Info.plist inside the .app.
 *
 *   bun scripts/release-metadata.ts --app build/Payload/Macros.app \
 *     --ipa build/Macros.ipa --entitlements ios/Macros/Macros.entitlements \
 *     --download-url https://… --notes notes.md --out release.json
 */
import { parseArgs } from "node:util";
import packageJson from "../package.json";
import {
  assertReleaseMetadata,
  privacyFromInfoPlist,
  type ReleaseMetadata,
} from "./sidestore-source";

function plistAsJson(path: string): Record<string, unknown> {
  const result = Bun.spawnSync(["plutil", "-convert", "json", "-o", "-", path]);
  if (result.exitCode !== 0) {
    throw new Error(
      `plutil could not read ${path}: ${result.stderr.toString()}`,
    );
  }
  const parsed: unknown = JSON.parse(result.stdout.toString());
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${path} is not a dictionary plist`);
  }
  return Object.fromEntries(Object.entries(parsed));
}

function stringField(plist: Record<string, unknown>, key: string): string {
  const value = plist[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Info.plist has no ${key}`);
  }
  return value;
}

const { values } = parseArgs({
  options: {
    app: { type: "string" },
    ipa: { type: "string" },
    entitlements: { type: "string" },
    "download-url": { type: "string" },
    notes: { type: "string" },
    date: { type: "string" },
    out: { type: "string" },
  },
});

const appPath = values.app;
const ipaPath = values.ipa;
const downloadURL = values["download-url"];
const outPath = values.out;
if (!appPath || !ipaPath || !downloadURL || !outPath) {
  throw new Error("--app, --ipa, --download-url and --out are required");
}

const infoPlist = plistAsJson(`${appPath}/Info.plist`);
const version = stringField(infoPlist, "CFBundleShortVersionString");
if (version !== packageJson.version) {
  throw new Error(
    `The IPA says ${version} but package.json says ${packageJson.version}`,
  );
}

const entitlements = values.entitlements
  ? Object.keys(plistAsJson(values.entitlements))
  : [];
const notes = values.notes
  ? (await Bun.file(values.notes).text()).trim()
  : `Macros ${version}`;

const metadata: ReleaseMetadata = assertReleaseMetadata({
  version,
  buildNumber: stringField(infoPlist, "CFBundleVersion"),
  date: values.date ?? new Date().toISOString(),
  size: Bun.file(ipaPath).size,
  downloadURL,
  minOSVersion: stringField(infoPlist, "MinimumOSVersion"),
  localizedDescription: notes || `Macros ${version}`,
  privacy: privacyFromInfoPlist(infoPlist),
  entitlements,
});

await Bun.write(outPath, `${JSON.stringify(metadata, null, 2)}\n`);
console.log(JSON.stringify(metadata));
