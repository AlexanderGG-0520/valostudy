import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://valostudy.alec-ofc.com";
  return [
    { url: baseUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${baseUrl}/demo`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${baseUrl}/docs`, changeFrequency: "monthly", priority: 0.6 },
  ];
}
