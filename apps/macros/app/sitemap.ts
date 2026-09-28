import type { MetadataRoute } from "next";
import { getPublicAppOrigin } from "@/lib/email";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getPublicAppOrigin();
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.3 },
  ];
}
