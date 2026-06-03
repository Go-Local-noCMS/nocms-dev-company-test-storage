import type { MetadataRoute } from "next";
import { fetchPosts, fetchLocations } from "@/lib/payload";

export const dynamic = "force-static";

const BASE_URL = process.env.SITE_URL ?? "https://example.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [posts, locations] = await Promise.all([fetchPosts(500), fetchLocations(500)]);

  const staticPages = [
    "",
    "/about",
    "/contact",
    "/pricing",
    "/resources",
    "/storage-locations",
    "/blog",
  ];
  const blogPages = posts.map((p) => `/blog/${p.slug}`);
  const locationPages = locations
    .filter((l) => l.locationType === "single")
    .map((l) => `/storage-locations/${l.slug}`);

  const allPages = [...staticPages, ...blogPages, ...locationPages];

  return allPages.map((path) => ({
    url: `${BASE_URL}${path}`,
    lastModified: new Date(),
    changeFrequency: path === "" ? "weekly" : "monthly",
    priority: path === "" ? 1.0 : path.split("/").length <= 2 ? 0.8 : 0.6,
  }));
}
