import type { MacrosStatisticsPeriod } from "@repo/schemas/macros";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  fetchStatisticsExport,
  type StatisticsExportFormat,
} from "@/api/statistics";

const FILE_TYPES: Record<
  StatisticsExportFormat,
  { uti: string; mimeType: string }
> = {
  csv: { uti: "public.comma-separated-values-text", mimeType: "text/csv" },
  json: { uti: "public.json", mimeType: "application/json" },
};

/**
 * Downloads the export into the cache directory and hands it to the share
 * sheet, where it can be saved to Files, AirDropped or opened in Numbers.
 */
export async function exportStatistics(
  period: MacrosStatisticsPeriod,
  format: StatisticsExportFormat,
  today: string,
): Promise<void> {
  const body = await fetchStatisticsExport(period, format);
  const file = new File(Paths.cache, `macros-${period}-${today}.${format}`);
  file.create({ overwrite: true });
  file.write(body);
  const type = FILE_TYPES[format];
  await Sharing.shareAsync(file.uri, {
    UTI: type.uti,
    mimeType: type.mimeType,
  });
}
