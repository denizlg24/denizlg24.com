import { modelSettingSchema } from "@repo/schemas";
import { DEFAULT_TTS_MODEL, TTS_MODELS, voicesForModel } from "@repo/tts";
import { type NextRequest, NextResponse } from "next/server";
import { getModelSettings, setModelSetting } from "@/lib/llm-model-settings";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  getAppTimeZone,
  isValidTimeZone,
  setAppTimeZone,
} from "@/lib/timezone";
import { getTtsSettings, setTtsSettings } from "@/lib/tts-settings";
import { AppSettings, type ILeanAppSettings } from "@/models/AppSettings";

async function buildSettingsResponse() {
  const settings = await AppSettings.findById("singleton")
    .lean<ILeanAppSettings>()
    .exec();
  const models = await getModelSettings();
  return {
    settings: {
      timeZone: settings?.timeZone ?? null,
      effectiveTimeZone: await getAppTimeZone(),
      ...models,
      ...(await getTtsSettings()),
    },
  };
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await connectDB();
    return NextResponse.json(await buildSettingsResponse());
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const modelKeys = ["semanticModel", "unattendedModel"] as const;
    const touchedModels = modelKeys.filter((key) => key in body);
    const touchesTts = ["ttsModel", "ttsVoice", "ttsInstructions"].some(
      (key) => key in body,
    );
    if (!("timeZone" in body) && touchedModels.length === 0 && !touchesTts) {
      return NextResponse.json(
        { error: "A settings field is required" },
        { status: 400 },
      );
    }

    for (const key of touchedModels) {
      const parsed = modelSettingSchema.safeParse(body[key]);
      if (!parsed.success) {
        return NextResponse.json(
          { error: `${key} must be a model id or null` },
          { status: 400 },
        );
      }
    }

    let validatedTimeZone: string | null | undefined;
    if ("timeZone" in body) {
      const value = body.timeZone;
      if (
        value !== null &&
        (typeof value !== "string" || !isValidTimeZone(value))
      ) {
        return NextResponse.json(
          { error: "timeZone must be a valid IANA timezone or null" },
          { status: 400 },
        );
      }
      validatedTimeZone = value;
    }

    if (touchesTts) {
      const existing = await getTtsSettings();
      const model = "ttsModel" in body ? body.ttsModel : existing.ttsModel;
      if (
        model !== null &&
        (typeof model !== "string" || !TTS_MODELS.some((id) => id === model))
      ) {
        return NextResponse.json(
          { error: "Unsupported speech model" },
          { status: 400 },
        );
      }
      const effectiveModel = model || DEFAULT_TTS_MODEL;
      const voice =
        "ttsVoice" in body
          ? body.ttsVoice
          : model !== existing.ttsModel
            ? null
            : existing.ttsVoice;
      if (
        voice !== null &&
        (typeof voice !== "string" ||
          !voicesForModel(effectiveModel).includes(voice))
      ) {
        return NextResponse.json(
          { error: "Unsupported voice for speech model" },
          { status: 400 },
        );
      }
      const instructions =
        "ttsInstructions" in body
          ? body.ttsInstructions
          : existing.ttsInstructions;
      if (
        instructions !== null &&
        (typeof instructions !== "string" || instructions.length > 1_000)
      ) {
        return NextResponse.json(
          { error: "Speech instructions must be at most 1,000 characters" },
          { status: 400 },
        );
      }
      await setTtsSettings({
        ...(model !== existing.ttsModel
          ? { ttsModel: model, ttsVoice: voice }
          : {}),
        ...("ttsVoice" in body ? { ttsVoice: voice } : {}),
        ...("ttsInstructions" in body ? { ttsInstructions: instructions } : {}),
      });
    }

    if (validatedTimeZone !== undefined)
      await setAppTimeZone(validatedTimeZone);

    for (const key of touchedModels) {
      await setModelSetting(key, modelSettingSchema.parse(body[key]));
    }
    return NextResponse.json(await buildSettingsResponse());
  } catch {
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
