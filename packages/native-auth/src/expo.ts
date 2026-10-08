import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import type { NativeAuthPlatform } from "./session";

/**
 * ASWebAuthenticationSession, not ephemeral: it shares Safari's cookies, so a
 * browser already signed in to auth.denizlg24.com comes straight back.
 */
export function expoAuthPlatform(
  fetcher: NativeAuthPlatform["fetch"],
): NativeAuthPlatform {
  return {
    async openAuthSession(url, redirectUri) {
      const result = await WebBrowser.openAuthSessionAsync(url, redirectUri, {
        preferEphemeralSession: false,
      });
      return result.type === "success" ? result.url : null;
    },
    randomBytes: (length) => Crypto.getRandomBytes(length),
    async sha256(input) {
      return new Uint8Array(
        await Crypto.digest(
          Crypto.CryptoDigestAlgorithm.SHA256,
          new TextEncoder().encode(input),
        ),
      );
    },
    fetch: fetcher,
  };
}
