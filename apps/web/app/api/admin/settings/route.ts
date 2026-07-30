import { modelSettingSchema } from "@repo/schemas";
import { type NextRequest, NextResponse } from "next/server";
import { getModelSettings, setModelSetting } from "@/lib/llm-model-settings";
import { connectDB } from "@/lib/mongodb";
import { requireAdmin } from "@/lib/require-admin";
import {
  getAppTimeZone,
  isValidTimeZone,
  setAppTimeZone,
} from "@/lib/timezone";
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
    if (!("timeZone" in body) && touchedModels.length === 0) {
      return NextResponse.json(
        { error: "timeZone, semanticModel or unattendedModel is required" },
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

    if ("timeZone" in body) {
      const timeZone = body.timeZone;
      if (timeZone !== null) {
        if (typeof timeZone !== "string" || !isValidTimeZone(timeZone)) {
          return NextResponse.json(
            { error: "timeZone must be a valid IANA timezone or null" },
            { status: 400 },
          );
        }
      }
      await setAppTimeZone(timeZone);
    }

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
