import type { MetadataRoute } from "next";
export default function sitemap(): MetadataRoute.Sitemap {
  const origin =
    process.env.STATUS_PUBLIC_URL ?? "https://status.denizlg24.com";
  return ["/", "/backups", "/incidents", "/maintenance"].map((path) => ({
    url: `${origin}${path}`,
    changeFrequency: "hourly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
