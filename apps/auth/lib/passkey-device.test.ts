import { beforeEach, describe, expect, it } from "bun:test";

const store = new Map<string, string>();
// `window.localStorage` is all the module touches, and the two scopes it keeps
// are only distinguishable through the keys it writes.
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  },
});

const {
  accountHasPasskeyOnDevice,
  forgetPasskeyDevice,
  hasPasskeyOnDevice,
  isPasskeyOfferSnoozed,
  rememberAccountPasskeyDevice,
  rememberPasskeyDevice,
  snoozePasskeyOffer,
} = await import("./passkey-device");

beforeEach(() => {
  store.clear();
});

describe("passkey device markers", () => {
  it("keeps one account's markers away from another's", () => {
    rememberAccountPasskeyDevice("user-a");
    snoozePasskeyOffer("user-a");
    expect(accountHasPasskeyOnDevice("user-a")).toBe(true);
    expect(isPasskeyOfferSnoozed("user-a")).toBe(true);
    expect(accountHasPasskeyOnDevice("user-b")).toBe(false);
    expect(isPasskeyOfferSnoozed("user-b")).toBe(false);
  });

  it("remembers the browser alongside the account", () => {
    rememberAccountPasskeyDevice("user-a");
    expect(hasPasskeyOnDevice()).toBe(true);
  });

  it("forgets only the browser-wide marker", () => {
    rememberAccountPasskeyDevice("user-a");
    forgetPasskeyDevice();
    expect(hasPasskeyOnDevice()).toBe(false);
    expect(accountHasPasskeyOnDevice("user-a")).toBe(true);
  });

  it("lets the snooze expire", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    snoozePasskeyOffer("user-a", now);
    expect(
      isPasskeyOfferSnoozed("user-a", new Date("2026-09-29T00:00:00.000Z")),
    ).toBe(true);
    expect(
      isPasskeyOfferSnoozed("user-a", new Date("2026-10-02T00:00:00.000Z")),
    ).toBe(false);
  });

  it("survives storage that refuses to answer", () => {
    const working = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get localStorage(): never {
          throw new Error("blocked");
        },
      },
    });
    try {
      expect(() => rememberPasskeyDevice()).not.toThrow();
      expect(hasPasskeyOnDevice()).toBe(false);
      expect(accountHasPasskeyOnDevice("user-a")).toBe(false);
      expect(isPasskeyOfferSnoozed("user-a")).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: working,
      });
    }
  });
});
