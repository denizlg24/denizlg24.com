import { toast } from "sonner";
import type { denizApi } from "@/lib/api-wrapper";
import type { ISpreadsheet } from "@/lib/data-types";

export async function downloadSpreadsheet(
  api: denizApi,
  sheet: Pick<ISpreadsheet, "_id" | "title">,
) {
  const res = await api.GET_RAW({
    endpoint: `spreadsheets/${sheet._id}/export`,
  });
  if ("code" in res) {
    toast.error("Failed to export");
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sheet.title}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
