import type { Metadata } from "next";
import { listFacilities } from "@/lib/facilities/loader";
import { FacilityCards } from "@/components/facility/FacilityCards";
import { CTABanner } from "@/components/content/CTABanner";
import skinConfig from "@/skin.config";
import { fetchLocations } from "@/lib/payload";

export const metadata: Metadata = {
  title: `Locations | ${skinConfig.brandName}`,
  description: `Find a ${skinConfig.brandName} self-storage location near you.`,
};

export default async function StorageLocationsIndexPage() {
  // Payload is the source of truth for which storage-locations exist. The
  // editorial slug doubles as the FMS identifier — the loader uses it to
  // pull operational data (hours, address, units) for the same record.
  const editorial = await fetchLocations();
  const singles = editorial.filter((l) => l.locationType === "single");
  const fmsAll = await listFacilities();
  const fmsBySlug = new Map(fmsAll.map((f) => [f.slug, f]));

  const facilities = singles
    .map((loc) => {
      const fms = fmsBySlug.get(loc.slug);
      if (!fms) return null;
      return { ...fms, name: loc.title || fms.name };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  const states = new Set(facilities.map((f) => f.state));
  const groupByState = facilities.length > 6 && states.size >= 2;

  return (
    <>
      <section
        data-nocms-component="storage-locations-hero"
        className="bg-primary py-16 lg:py-20 text-center text-white"
      >
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1
            data-role="heading"
            className="font-heading text-4xl sm:text-5xl font-bold leading-tight"
          >
            Our locations
          </h1>
          <p data-role="subheading" className="mt-4 text-lg text-white/85">
            {facilities.length} {facilities.length === 1 ? "facility" : "facilities"} ready to store your stuff.
          </p>
        </div>
      </section>

      <section className="py-12 lg:py-16 bg-background">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          {facilities.length === 0 ? (
            <p className="text-center text-muted" data-role="text">
              No locations yet — add one in your CMS to publish it here.
            </p>
          ) : groupByState ? (
            <div className="space-y-12">
              {Array.from(states)
                .sort()
                .map((state) => {
                  const inState = facilities.filter((f) => f.state === state);
                  return (
                    <FacilityCards
                      key={state}
                      heading={state}
                      facilities={inState}
                    />
                  );
                })}
            </div>
          ) : (
            <FacilityCards facilities={facilities} />
          )}
        </div>
      </section>

      <CTABanner
        heading="Don't see a location near you?"
        subheading="Call us — we may have an opening at a nearby facility, or we can recommend partners."
        primaryCta={{ label: "Contact us", href: "/contact" }}
        phone={skinConfig.contactPhone}
      />
    </>
  );
}
