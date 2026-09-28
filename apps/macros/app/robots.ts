import type { MetadataRoute } from "next";
import { getPublicAppOrigin } from "@/lib/email";

export default function robots(): MetadataRoute.Robots {
  const origin = getPublicAppOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/register/"],
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
