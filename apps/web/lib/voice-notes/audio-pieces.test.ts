import { describe, expect, mock, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

mock.module("server-only", () => ({}));

const { AUDIO_PIECE_SECONDS, withAudioPieces } = await import("./audio-pieces");

const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
const ffmpegWorks =
  spawnSync(ffmpeg, ["-hide_banner", "-version"], { stdio: "ignore" })
    .status === 0;

function synthesizeWebm(seconds: number) {
  const directory = mkdtempSync(path.join(tmpdir(), "voice-pieces-test-"));
  try {
    const result = spawnSync(
      ffmpeg,
      [
        "-hide_banner",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=frequency=220:duration=${seconds}`,
        "-ac",
        "1",
        "-c:a",
        "libopus",
        "-b:a",
        "24k",
        "clip.webm",
      ],
      { cwd: directory },
    );
    if (result.status !== 0) throw new Error(String(result.stderr));
    return new Uint8Array(readFileSync(path.join(directory, "clip.webm")));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe.skipIf(!ffmpegWorks)("withAudioPieces", () => {
  test("cuts a recording into consecutive pieces that load on demand", async () => {
    const bytes = synthesizeWebm(AUDIO_PIECE_SECONDS * 2 + 40);
    const pieces = await withAudioPieces(
      { bytes, filename: "voice-note.webm", mimeType: "audio/webm" },
      async (pieces) =>
        Promise.all(
          pieces.map(async (piece) => ({
            index: piece.index,
            startSecond: piece.startSecond,
            endSecond: piece.endSecond,
            file: await piece.load(),
          })),
        ),
    );
    expect(pieces).toHaveLength(3);
    expect(pieces.map((piece) => Math.round(piece.startSecond))).toEqual([
      0,
      AUDIO_PIECE_SECONDS,
      AUDIO_PIECE_SECONDS * 2,
    ]);
    expect(Math.round(pieces.at(-1)?.endSecond ?? 0)).toBe(
      AUDIO_PIECE_SECONDS * 2 + 40,
    );
    for (const piece of pieces) {
      expect(piece.file.type).toBe("audio/webm");
      expect(piece.file.size).toBeGreaterThan(0);
    }
  }, 60_000);

  test("removes its working directory once the work is done", async () => {
    let loadAfter: (() => Promise<File>) | undefined;
    await withAudioPieces(
      {
        bytes: synthesizeWebm(5),
        filename: "short.webm",
        mimeType: "audio/webm",
      },
      async (pieces) => {
        expect(pieces).toHaveLength(1);
        loadAfter = pieces[0]?.load;
      },
    );
    expect(loadAfter).toBeDefined();
    await expect(loadAfter?.()).rejects.toThrow();
  }, 60_000);
});
