import * as Crypto from "expo-crypto";

/**
 * `@denizlg24/auth` is written for browsers: PKCE needs `crypto.subtle.digest`
 * and `crypto.getRandomValues`, token requests use `AbortSignal.timeout`, and
 * `jose` builds a `TextDecoder` when it loads. Hermes has none of the first
 * three and only some builds the last, so this must be imported before the SDK.
 */

if (typeof globalThis.crypto?.subtle?.digest !== "function") {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) Crypto.getRandomValues(array);
        return array;
      },
      subtle: {
        async digest(algorithm: string, data: BufferSource) {
          if (algorithm !== "SHA-256") {
            throw new Error(`Unsupported digest ${algorithm}`);
          }
          return Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, data);
        },
      },
    },
  });
}

if (typeof AbortSignal.timeout !== "function") {
  Object.defineProperty(AbortSignal, "timeout", {
    configurable: true,
    value: (ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    },
  });
}

if (typeof globalThis.TextDecoder !== "function") {
  class Utf8Decoder {
    readonly encoding = "utf-8";
    decode(input?: ArrayBuffer | ArrayBufferView): string {
      if (!input) return "";
      const bytes =
        input instanceof ArrayBuffer
          ? new Uint8Array(input)
          : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      return decodeURIComponent(
        Array.from(
          bytes,
          (byte) => `%${byte.toString(16).padStart(2, "0")}`,
        ).join(""),
      );
    }
  }
  Object.defineProperty(globalThis, "TextDecoder", {
    configurable: true,
    value: Utf8Decoder,
  });
}
