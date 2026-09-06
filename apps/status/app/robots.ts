import type { MetadataRoute } from "next";
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/"] },
    sitemap: `${process.env.STATUS_PUBLIC_URL ?? "https://status.denizlg24.com"}/sitemap.xml`,
  };
}
