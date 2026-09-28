import {
  DEFAULT_TTS_MODEL,
  defaultVoiceForModel,
  TTS_MODELS,
  voicesForModel,
} from "@repo/tts";
import { AppSettings, type ILeanAppSettings } from "@/models/AppSettings";
import { connectDB } from "./mongodb";

export async function getTtsSettings() {
  await connectDB();
  const stored = await AppSettings.findById("singleton")
    .lean<ILeanAppSettings>()
    .exec();
  const model =
    stored?.ttsModel && TTS_MODELS.some((id) => id === stored.ttsModel)
      ? stored.ttsModel
      : DEFAULT_TTS_MODEL;
  const voice =
    stored?.ttsVoice && voicesForModel(model).includes(stored.ttsVoice)
      ? stored.ttsVoice
      : defaultVoiceForModel(model);
  return {
    ttsModel: stored?.ttsModel ?? null,
    effectiveTtsModel: model,
    ttsVoice: stored?.ttsVoice ?? null,
    effectiveTtsVoice: voice,
    ttsInstructions: stored?.ttsInstructions ?? null,
  };
}

export async function setTtsSettings(update: {
  ttsModel?: string | null;
  ttsVoice?: string | null;
  ttsInstructions?: string | null;
}) {
  await connectDB();
  await AppSettings.findByIdAndUpdate("singleton", update, {
    upsert: true,
  }).exec();
}
