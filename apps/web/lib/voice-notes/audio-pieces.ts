import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * `gpt-transcribe` refuses a long single request with a bare
 * `500 Audio file processing failed` — every recording past ~20 minutes did —
 * so audio is cut into pieces that each stay far below that. Five minutes also
 * keeps a failed request cheap to repeat.
 */
export const AUDIO_PIECE_SECONDS = 300;
const SPLIT_TIMEOUT_MS = 120_000;

export interface AudioPiece {
  index: number;
  startSecond: number;
  endSecond: number;
  /** Read on demand so a long recording is never held in memory twice. */
  load: () => Promise<File>;
}

interface PieceFormat {
  extension: string;
  mimeType: string;
  muxer: string;
  /** PCM would blow the per-request size limit, so only it is re-encoded. */
  codec: string[];
}

function pieceFormat(mimeType: string, filename: string): PieceFormat {
  const mime = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  const extension = path.extname(filename).toLowerCase();
  const copy = ["-c", "copy"];
  if (mime.includes("webm") || extension === ".webm") {
    return {
      extension: "webm",
      mimeType: "audio/webm",
      muxer: "webm",
      codec: copy,
    };
  }
  if (mime.includes("ogg") || extension === ".ogg") {
    return {
      extension: "ogg",
      mimeType: "audio/ogg",
      muxer: "ogg",
      codec: copy,
    };
  }
  if (
    mime.includes("mp4") ||
    mime.includes("m4a") ||
    extension === ".m4a" ||
    extension === ".mp4"
  ) {
    return {
      extension: "m4a",
      mimeType: "audio/mp4",
      muxer: "mp4",
      codec: copy,
    };
  }
  if (
    mime.includes("mpeg") ||
    mime.includes("mp3") ||
    [".mp3", ".mpeg", ".mpga"].includes(extension)
  ) {
    return {
      extension: "mp3",
      mimeType: "audio/mpeg",
      muxer: "mp3",
      codec: copy,
    };
  }
  return {
    extension: "ogg",
    mimeType: "audio/ogg",
    muxer: "ogg",
    codec: ["-c:a", "libopus", "-b:a", "32k", "-ac", "1"],
  };
}

function runFfmpeg(args: string[], cwd: string): Promise<void> {
  const binary = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4_000);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), SPLIT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`ffmpeg could not start: ${error.message}`));
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `ffmpeg failed (${signal ?? `exit ${code}`}): ${stderr.trim().split("\n").at(-1) ?? ""}`,
          ),
        );
    });
  });
}

/**
 * Splits audio into pieces of `AUDIO_PIECE_SECONDS` without re-encoding it
 * where the container allows, and hands them to `work` while they exist on
 * disk. The cut points depend only on the input and the piece length, so a
 * retry of the same note yields the same pieces — which is what lets
 * transcription resume from the segments already stored.
 */
export async function withAudioPieces<T>(
  input: { bytes: Uint8Array; filename: string; mimeType: string },
  work: (pieces: AudioPiece[]) => Promise<T>,
): Promise<T> {
  const format = pieceFormat(input.mimeType, input.filename);
  const directory = await mkdtemp(path.join(tmpdir(), "voice-pieces-"));
  try {
    const source = `source${path.extname(input.filename).toLowerCase() || ".bin"}`;
    await writeFile(path.join(directory, source), input.bytes);
    await runFfmpeg(
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-i",
        source,
        "-map",
        "0:a:0",
        "-vn",
        ...format.codec,
        "-f",
        "segment",
        "-segment_time",
        String(AUDIO_PIECE_SECONDS),
        "-segment_format",
        format.muxer,
        "-reset_timestamps",
        "1",
        "-segment_list",
        "pieces.csv",
        "-segment_list_type",
        "csv",
        `piece%04d.${format.extension}`,
      ],
      directory,
    );

    const list = await readFile(path.join(directory, "pieces.csv"), "utf8");
    const pieces: AudioPiece[] = [];
    for (const line of list.split("\n")) {
      const [name, start, end] = line.trim().split(",");
      if (!name || start === undefined || end === undefined) continue;
      const file = path.join(directory, name);
      pieces.push({
        index: pieces.length,
        startSecond: Number(start),
        endSecond: Number(end),
        load: async () =>
          new File([await readFile(file)], name, { type: format.mimeType }),
      });
    }
    if (pieces.length === 0) {
      throw new Error("ffmpeg produced no audio pieces");
    }
    return await work(pieces);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
