import { describeUserAgent } from "@repo/auth-ui/user-agent";

/**
 * Where a passkey provider makes a credential available. A synced passkey
 * follows its provider's account, not the device it was made on: an iCloud
 * Keychain passkey made on an iPhone is on the owner's Mac too, and a
 * 1Password one is wherever the extension is. A device-bound one is nowhere
 * else, however it is flagged.
 */
export type PasskeyReach =
  | "apple"
  | "google"
  | "samsung"
  | "anywhere"
  | "device";

// AAGUIDs as published in the community passkey-authenticator-aaguids list.
// The zero AAGUID and anything unlisted fall through to the name heuristic.
const PROVIDER_REACH: Record<string, PasskeyReach> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "apple", // iCloud Keychain
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "apple", // iCloud Keychain (Managed)
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "google", // Google Password Manager
  "53414d53-554e-4700-0000-000000000000": "samsung", // Samsung Pass
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "device", // Windows Hello
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "device", // Windows Hello
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "device", // Windows Hello
  "adce0002-35bc-c60a-648b-0b25f1f05503": "device", // Chrome on Mac
  "771b48fd-d3d4-4f74-9232-fc157ab0507a": "device", // Edge on Mac
  "b5397666-4885-aa6b-cebf-e52262a439a2": "device", // Chromium Browser
  "bada5566-a7aa-401f-bd96-45619a55120d": "anywhere", // 1Password
  "d548826e-79b4-db40-a3d8-11116f7e8349": "anywhere", // Bitwarden
  "531126d6-e717-415c-9320-3d9aa6981239": "anywhere", // Dashlane
  "50726f74-6f6e-5061-7373-50726f746f6e": "anywhere", // Proton Pass
  "b84e4048-15dc-4dd0-8640-f4f60813c8af": "anywhere", // NordPass
  "0ea242b4-43c4-4a1b-8b17-dd6d0b6baec6": "anywhere", // Keeper
  "f3809540-7f14-49c1-a8b3-8f813b225541": "anywhere", // Enpass
  "fdb141b2-5d84-443e-8a35-4698c205a502": "anywhere", // KeePassXC
};

const APPLE_PLATFORMS = new Set(["iPhone", "iPad", "Mac"]);

export interface KnownPasskey {
  aaguid?: string | null;
  backedUp: boolean;
  deviceType: string;
  /** Defaults to the registering platform ("iPhone", "Mac"); renamable. */
  name?: string | null;
}

/**
 * Older Apple and Android platforms register with the zero AAGUID, so a
 * backed-up passkey with no known provider is placed by the platform it was
 * named after at registration. A renamed one reads as unknown, which offers.
 */
export function passkeyReach(passkey: KnownPasskey): PasskeyReach | null {
  const known = passkey.aaguid
    ? PROVIDER_REACH[passkey.aaguid.toLowerCase()]
    : undefined;
  if (known) return known;
  if (!passkey.backedUp || passkey.deviceType !== "multiDevice") {
    return "device";
  }
  const named = passkey.name?.trim();
  if (named && APPLE_PLATFORMS.has(named)) return "apple";
  if (named === "Android") return "google";
  return null;
}

export function reachesPlatform(
  reach: PasskeyReach,
  agent: { platform: string | null; browser: string | null },
): boolean {
  switch (reach) {
    case "anywhere":
      return true;
    case "device":
      return false;
    case "apple":
      return agent.platform !== null && APPLE_PLATFORMS.has(agent.platform);
    case "google":
      return agent.platform === "Android" || agent.browser === "Chrome";
    case "samsung":
      return agent.platform === "Android";
  }
}

export type PasskeyOfferDecision =
  | "offer"
  | "dismissed"
  | "snoozed"
  | "device-has-one"
  | "synced-here";

/**
 * Whether to put the passkey offer between a password sign-in and the app
 * the visitor was heading to. Account and browser choices come first; then
 * a passkey already usable on this platform makes the offer redundant. The
 * only exact signal — the authenticator refusing a duplicate — arrives when
 * the visitor accepts, and the caller handles that as "device has one".
 */
export function decidePasskeyOffer(input: {
  passkeys: KnownPasskey[];
  userAgent: string;
  deviceHasPasskey: boolean;
  dismissed: boolean;
  snoozed: boolean;
}): PasskeyOfferDecision {
  if (input.dismissed) return "dismissed";
  if (input.snoozed) return "snoozed";
  if (input.deviceHasPasskey) return "device-has-one";
  const agent = describeUserAgent(input.userAgent);
  const syncedHere = input.passkeys.some((passkey) => {
    const reach = passkeyReach(passkey);
    return reach !== null && reachesPlatform(reach, agent);
  });
  return syncedHere ? "synced-here" : "offer";
}
