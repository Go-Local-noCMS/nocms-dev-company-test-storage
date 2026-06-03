import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getFacility } from "@/lib/facilities/loader";
import { fetchLocations } from "@/lib/payload";
import { getUnitGroups } from "@/lib/api/getUnitGroups";
import { UnitGroupCard } from "@/components/storage/UnitGroupCard";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { CTABanner } from "@/components/content/CTABanner";
import type { UnitGroup } from "@/types/UnitGroup";
import type { Facility } from "@/types/Facility";

type Params = { slug: string };
type Props = { params: Promise<Params> };

async function loadFacility(slug: string): Promise<Facility | null> {
  return await getFacility(slug);
}

export async function generateStaticParams(): Promise<Params[]> {
  // Payload is the source of truth — single-type locations produce a unit-groups
  // route. The same slug is the FMS identifier used by the loader at render.
  const locations = await fetchLocations(200);
  const singles = locations.filter((l) => l.locationType === "single");
  if (singles.length === 0) return [{ slug: "_placeholder" }];
  return singles.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (slug === "_placeholder") return { title: "Available sizes" };
  const facility = await loadFacility(slug);
  if (!facility) return { title: "Sizes not found" };
  return {
    title: `Available sizes — ${facility.name}`,
    description: `Reserve a storage unit at ${facility.name} in ${facility.address.city}, ${facility.address.state}.`,
  };
}

function applyDisplayRules(groups: UnitGroup[]): UnitGroup[] {
  return groups
    .filter((g) => g.availableUnitCount > 0)
    .filter((g) => !(g.types?.vehicleRv === true && g.types?.selfStorage !== true));
}

function groupByUnitType(groups: UnitGroup[]): Map<string, UnitGroup[]> {
  const out = new Map<string, UnitGroup[]>();
  for (const g of groups) {
    const list = out.get(g.unitType) ?? [];
    list.push(g);
    out.set(g.unitType, list);
  }
  return out;
}

export default async function UnitGroupsPage({ params }: Props) {
  const { slug } = await params;
  if (slug === "_placeholder") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold" data-role="heading-2">Available sizes</h1>
        <p className="mt-4 text-zinc-600" data-role="text">
          Pick a location on the locations page to see available units.
        </p>
      </main>
    );
  }
  const facility = await loadFacility(slug);
  if (!facility) notFound();

  let unitGroups: UnitGroup[] = [];
  let loadError: Error | null = null;
  try {
    unitGroups = await getUnitGroups(facility.id);
  } catch (err) {
    loadError = err as Error;
  }

  const visible = applyDisplayRules(unitGroups);
  const grouped = groupByUnitType(visible);

  return (
    <>
      <section
        data-nocms-component="unit-groups-header"
        className="bg-surface py-10 lg:py-14"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Breadcrumbs
            items={[
              { label: "Locations", href: "/storage-locations" },
              { label: facility.name, href: `/storage-locations/${facility.slug}` },
              { label: "Available units" },
            ]}
            className="mb-6"
          />
          <h1
            data-role="heading"
            className="font-heading text-3xl sm:text-4xl font-bold text-text"
          >
            Available units — {facility.name}
          </h1>
          <p data-role="subheading" className="mt-2 text-muted">
            {facility.address.city}, {facility.address.state}
          </p>
        </div>
      </section>

      <section className="py-12 lg:py-16 bg-background">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {loadError ? (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-6">
              <p className="text-red-800 font-medium" data-role="text-2">
                We&apos;re having trouble loading availability right now.
              </p>
              <p className="mt-2 text-red-700 text-sm" data-role="text-3">
                Please try again shortly, or call {facility.phone ?? "us"} for help.
              </p>
              {process.env.NODE_ENV !== "production" && (
                <pre className="mt-3 whitespace-pre-wrap text-xs text-red-600">
                  {loadError.message}
                </pre>
              )}
            </div>
          ) : visible.length === 0 ? (
            <p className="text-zinc-700" data-role="text-4">
              No units currently available at {facility.name}.{" "}
              {facility.phone && (
                <a href={`tel:${facility.phone.replace(/\s/g, "")}`} className="underline" data-role="text-5">
                  Give us a call
                </a>
              )}{" "}
              and we&apos;ll let you know when something opens up.
            </p>
          ) : (
            <div className="space-y-12">
              {Array.from(grouped.entries()).map(([unitType, groups]) => (
                <section key={unitType} aria-labelledby={`type-${unitType}`}>
                  <h2
                    id={`type-${unitType}`}
                    className="font-heading text-xl font-semibold text-text mb-4" data-role="heading-3"
                  >
                    {unitType}
                  </h2>
                  <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {groups.map((g) => (
                      <li key={g.unitGroupUuid}>
                        <UnitGroupCard
                          group={g}
                          reserveHref={`/storage-locations/${facility.slug}/reserve/${g.unitGroupUuid}`}
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      </section>

      <CTABanner
        heading="Questions about a size?"
        subheading="Our team can talk you through what fits — call any time during office hours."
        primaryCta={{ label: "Contact us", href: "/contact" }}
        phone={facility.phone ?? undefined}
      />
    </>
  );
}
