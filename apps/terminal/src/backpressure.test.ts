import { describe, expect, it } from "bun:test";

import { TerminalOutputBridge } from "./backpressure";
import type { AttachedTmuxClient } from "./sessions";

describe("terminal output backpressure", () => {
  it("pauses a flooding PTY above 1 MiB and resumes below 256 KiB", () => {
    let buffered = 0;
    let pauses = 0;
    let resumes = 0;
    const terminal: AttachedTmuxClient = {
      close() {},
      pauseOutput() {
        pauses += 1;
      },
      resize() {},
      resumeOutput() {
        resumes += 1;
      },
      write() {},
    };
    const bridge = new TerminalOutputBridge(
      {
        bufferedAmount: () => buffered,
        send(data) {
          buffered += data.byteLength;
        },
      },
      terminal,
    );
    const yesChunk = new TextEncoder().encode("y\n".repeat(300_000));

    bridge.write(yesChunk);
    bridge.write(yesChunk);
    bridge.write(yesChunk);
    expect(pauses).toBe(1);

    buffered = 128 * 1_024;
    bridge.drain();
    expect(resumes).toBe(1);
  });
});
