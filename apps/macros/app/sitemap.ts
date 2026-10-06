import type { MetadataRoute } from "next";
import { getPublicAppOrigin } from "@/lib/email";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getPublicAppOrigin();
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/features`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/coach`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/download`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${origin}/changelog`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/support`, changeFrequency: "yearly", priority: 0.4 },
    {
      url: `${origin}/account/delete`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
