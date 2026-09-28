import type { MacrosBodyMeasurementSite } from "@repo/schemas/macros";

export const MEASUREMENT_SITES: readonly {
  value: MacrosBodyMeasurementSite;
  label: string;
}[] = [
  { value: "waist", label: "Waist" },
  { value: "hips", label: "Hips" },
  { value: "chest", label: "Chest" },
  { value: "neck", label: "Neck" },
  { value: "left_arm", label: "Left arm" },
  { value: "right_arm", label: "Right arm" },
  { value: "left_thigh", label: "Left thigh" },
  { value: "right_thigh", label: "Right thigh" },
  { value: "calf", label: "Calf" },
  { value: "body_fat", label: "Body fat" },
];

export function siteLabel(site: MacrosBodyMeasurementSite) {
  return MEASUREMENT_SITES.find((entry) => entry.value === site)?.label ?? site;
}

export function isMeasurementSite(
  value: string | undefined,
): value is MacrosBodyMeasurementSite {
  return MEASUREMENT_SITES.some((entry) => entry.value === value);
}
