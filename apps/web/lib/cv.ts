import { connectDB } from "@/lib/mongodb";
import { AppSettings, type ILeanAppSettings } from "@/models/AppSettings";

const FALLBACK_CV_URL = "/assets/DenizGunesCV2026.pdf";

/** URL the public resume button points at: the uploaded CV, or the bundled fallback. */
export async function getCvUrl(): Promise<string> {
  try {
    await connectDB();
    const settings = await AppSettings.findById("singleton")
      .lean<ILeanAppSettings>()
      .exec();
    return settings?.cv?.url ?? FALLBACK_CV_URL;
  } catch {
    return FALLBACK_CV_URL;
  }
}
