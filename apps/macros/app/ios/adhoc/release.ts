// The rolling release .github/workflows/macros-mobile.yml replaces on every
// ad-hoc build. The IPA inside it only installs on the UDIDs in its
// provisioning profile, so serving it publicly gives nothing away.
const RELEASE_URL =
  "https://github.com/denizlg24/denizlg24.com/releases/download/macros-ios-adhoc";

export function adhocAssetUrl(name: "manifest.plist" | "Macros.ipa"): string {
  return `${RELEASE_URL}/${name}`;
}
