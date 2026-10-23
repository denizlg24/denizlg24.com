import { expect, test } from "bun:test";
import { embedEnvironment, serverEmbedEnvironment } from "./embed-environment";

test("only the immutable native capability in the top frame removes the sandbox", () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    for (const [value, writable, configurable, topFrame, expected] of [
      [undefined, false, false, true, "web"],
      [1, true, true, true, "web"],
      [1, false, true, true, "web"],
      [0, false, false, true, "web"],
      [1, false, false, false, "web"],
      [1, false, false, true, "native"],
    ] as const) {
      const host: Record<string, unknown> = {};
      host.top = topFrame ? host : {};
      if (value !== undefined)
        Object.defineProperty(host, "__STREAM_NATIVE_BLOCKER__", {
          value,
          writable,
          configurable,
        });
      Object.defineProperty(globalThis, "window", {
        value: host,
        configurable: true,
      });
      expect(embedEnvironment()).toBe(expected);
      expect(serverEmbedEnvironment()).toBe("pending");
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
