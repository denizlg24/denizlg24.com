import { speechChunks } from "@repo/tts";
import { type AudioPlayer, createAudioPlayer } from "expo-audio";
import { File, Paths } from "expo-file-system";
import { send } from "@/lib/api";

/**
 * Speaks a reply through the site's `tts` route: cut into requests that grow
 * along `@repo/tts`'s targets, so the first sentence plays while the rest is
 * still being synthesised, and each next chunk fetched while one plays.
 */
export function createSpeaker() {
  let sequence = 0;
  let player: AudioPlayer | null = null;
  let finishCurrent: (() => void) | null = null;
  const files: File[] = [];

  async function synthesise(text: string, index: number, mine: number) {
    const response = await send("tts", { method: "POST", body: { text } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const wav = response.headers.get("content-type")?.includes("wav");
    const file = new File(
      Paths.cache,
      `speech-${mine}-${index}.${wav ? "wav" : "mp3"}`,
    );
    if (file.exists) file.delete();
    file.create();
    file.write(bytes);
    files.push(file);
    return file;
  }

  function play(file: File) {
    player ??= createAudioPlayer(null);
    const current = player;
    return new Promise<void>((resolve) => {
      finishCurrent = resolve;
      const subscription = current.addListener(
        "playbackStatusUpdate",
        (status) => {
          if (!status.didJustFinish) return;
          subscription.remove();
          finishCurrent = null;
          resolve();
        },
      );
      current.replace({ uri: file.uri });
      current.play();
    });
  }

  function cleanUp() {
    for (const file of files.splice(0)) {
      try {
        file.delete();
      } catch {}
    }
  }

  return {
    /** Resolves when the whole reply has played, or when `stop` cut it short. */
    async speak(text: string, onStart?: () => void) {
      const mine = ++sequence;
      const chunks: string[] = [];
      for await (const chunk of speechChunks([text])) chunks.push(chunk);
      if (chunks.length === 0) return;
      let next = synthesise(chunks[0] ?? "", 0, mine);
      try {
        for (let index = 0; index < chunks.length; index++) {
          const file = await next;
          if (mine !== sequence) return;
          if (index + 1 < chunks.length) {
            next = synthesise(chunks[index + 1] ?? "", index + 1, mine);
          }
          if (index === 0) onStart?.();
          await play(file);
          if (mine !== sequence) return;
        }
      } finally {
        if (mine === sequence) cleanUp();
      }
    },
    stop() {
      sequence += 1;
      player?.pause();
      finishCurrent?.();
      finishCurrent = null;
      cleanUp();
    },
    release() {
      this.stop();
      player?.remove();
      player = null;
    },
  };
}

export type Speaker = ReturnType<typeof createSpeaker>;
