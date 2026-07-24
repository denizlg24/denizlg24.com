import type { AttachedTmuxClient } from "./sessions";

export const OUTPUT_HIGH_WATERMARK = 1024 * 1024;
export const OUTPUT_LOW_WATERMARK = 256 * 1024;

export interface BufferedSocket {
  bufferedAmount(): number;
  send(data: Uint8Array): void;
}

export class TerminalOutputBridge {
  private paused = false;

  constructor(
    private readonly socket: BufferedSocket,
    private readonly terminal: AttachedTmuxClient,
  ) {}

  write(data: Uint8Array): void {
    this.socket.send(data);
    if (!this.paused && this.socket.bufferedAmount() > OUTPUT_HIGH_WATERMARK) {
      this.paused = true;
      this.terminal.pauseOutput();
    }
  }

  drain(): void {
    if (this.paused && this.socket.bufferedAmount() < OUTPUT_LOW_WATERMARK) {
      this.paused = false;
      this.terminal.resumeOutput();
    }
  }
}
