import { fetchPosts, fetchLocations } from "@/lib/payload";
import { listFacilities } from "@/lib/facilities/loader";
import { SiteSearchClient, type SearchableItem } from "./SearchClient";

export default async function SiteSearchPage() {
  const [posts, locations, facilities] = await Promise.all([
    fetchPosts(200),
    fetchLocations(200),
    listFacilities(),
  ]);

  // Storage-locations: Payload single-type docs, joined to FMS for city/state.
  const fmsBySlug = new Map(facilities.map((f) => [f.slug, f]));
  const facilityItems: SearchableItem[] = locations
    .filter((loc) => loc.locationType === "single")
    .map((loc) => {
      const fms = fmsBySlug.get(loc.slug);
      const city = fms?.city ?? loc.city ?? "";
      const state = fms?.state ?? loc.state ?? "";
      return {
        kind: "facility" as const,
        title: loc.title || fms?.name || loc.slug,
        href: `/storage-locations/${loc.slug}`,
        description: [city, state].filter(Boolean).join(", "),
        haystack: `${loc.title} ${city} ${state}`.toLowerCase(),
      };
    });

  const postItems: SearchableItem[] = posts.map((p) => ({
    kind: "post",
    title: p.title,
    href: `/blog/${p.slug}`,
    description: p.excerpt ?? "",
    haystack: `${p.title} ${p.excerpt ?? ""}`.toLowerCase(),
  }));

  return <SiteSearchClient items={[...facilityItems, ...postItems]} />;
}
