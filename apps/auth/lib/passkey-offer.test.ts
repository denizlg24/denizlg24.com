import { describe, expect, it } from "bun:test";
import { decidePasskeyOffer, passkeyReach } from "./passkey-offer";

const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const FIREFOX_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const ICLOUD_AAGUID = "fbfc3007-154e-4ecc-8c0b-6e020557d7bd";
const WINDOWS_HELLO_AAGUID = "08987058-cadc-4b81-b6e1-30de50dcbe96";
const ONE_PASSWORD_AAGUID = "bada5566-a7aa-401f-bd96-45619a55120d";
const GOOGLE_AAGUID = "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4";

const icloud = {
  aaguid: ICLOUD_AAGUID,
  backedUp: true,
  deviceType: "multiDevice",
  name: "iPhone",
};
const base = { deviceHasPasskey: false, dismissed: false, snoozed: false };

describe("decidePasskeyOffer", () => {
  it("offers on a Windows laptop when the only passkey is in iCloud Keychain", () => {
    expect(
      decidePasskeyOffer({
        ...base,
        passkeys: [icloud],
        userAgent: CHROME_WINDOWS,
      }),
    ).toBe("offer");
  });

  it("does not offer on a Mac for an iCloud passkey made on an iPhone", () => {
    expect(
      decidePasskeyOffer({
        ...base,
        passkeys: [icloud],
        userAgent: SAFARI_MAC,
      }),
    ).toBe("synced-here");
  });

  it("offers on an iPhone when the only passkey is Windows Hello", () => {
    expect(
      decidePasskeyOffer({
        ...base,
        passkeys: [
          {
            aaguid: WINDOWS_HELLO_AAGUID,
            backedUp: false,
            deviceType: "singleDevice",
            name: "Windows",
          },
        ],
        userAgent: SAFARI_IPHONE,
      }),
    ).toBe("offer");
  });

  it("never offers over a cross-platform password manager", () => {
    expect(
      decidePasskeyOffer({
        ...base,
        passkeys: [
          {
            aaguid: ONE_PASSWORD_AAGUID,
            backedUp: true,
            deviceType: "multiDevice",
            name: "Mac",
          },
        ],
        userAgent: FIREFOX_WINDOWS,
      }),
    ).toBe("synced-here");
  });

  it("counts a Google passkey as present in Chrome anywhere, but not in Firefox", () => {
    const google = {
      aaguid: GOOGLE_AAGUID,
      backedUp: true,
      deviceType: "multiDevice",
      name: "Android",
    };
    expect(
      decidePasskeyOffer({
        ...base,
        passkeys: [google],
        userAgent: CHROME_WINDOWS,
      }),
    ).toBe("synced-here");
    expect(
      decidePasskeyOffer({
        ...base,
        passkeys: [google],
        userAgent: FIREFOX_WINDOWS,
      }),
    ).toBe("offer");
  });

  it("offers with no passkeys at all", () => {
    expect(
      decidePasskeyOffer({ ...base, passkeys: [], userAgent: SAFARI_MAC }),
    ).toBe("offer");
  });

  it("honours the account flag, the snooze and the device marker in that order", () => {
    const input = { passkeys: [], userAgent: SAFARI_MAC };
    expect(
      decidePasskeyOffer({
        ...input,
        dismissed: true,
        snoozed: true,
        deviceHasPasskey: true,
      }),
    ).toBe("dismissed");
    expect(
      decidePasskeyOffer({
        ...input,
        dismissed: false,
        snoozed: true,
        deviceHasPasskey: true,
      }),
    ).toBe("snoozed");
    expect(
      decidePasskeyOffer({
        ...input,
        dismissed: false,
        snoozed: false,
        deviceHasPasskey: true,
      }),
    ).toBe("device-has-one");
  });
});

describe("passkeyReach", () => {
  it("places a zero-AAGUID synced passkey by the platform it was named after", () => {
    const zero = "00000000-0000-0000-0000-000000000000";
    expect(
      passkeyReach({
        aaguid: zero,
        backedUp: true,
        deviceType: "multiDevice",
        name: "iPhone",
      }),
    ).toBe("apple");
    expect(
      passkeyReach({
        aaguid: zero,
        backedUp: true,
        deviceType: "multiDevice",
        name: "Work laptop",
      }),
    ).toBeNull();
  });

  it("treats anything not backed up as bound to its device", () => {
    expect(
      passkeyReach({
        aaguid: null,
        backedUp: false,
        deviceType: "multiDevice",
        name: "iPhone",
      }),
    ).toBe("device");
  });
});
