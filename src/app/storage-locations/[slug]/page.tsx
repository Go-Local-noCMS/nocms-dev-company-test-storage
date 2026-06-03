import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getFacility } from "@/lib/facilities/loader";
import { FacilityHours } from "@/components/facility/FacilityHours";
import { FacilityFeatures } from "@/components/facility/FacilityFeatures";
import { FacilityContactInfo } from "@/components/facility/FacilityContactInfo";
import { FacilityGallery } from "@/components/facility/FacilityGallery";
import { CTABanner } from "@/components/content/CTABanner";
import { Breadcrumbs } from "@/components/layout/Breadcrumbs";
import { fetchLocations, fetchLocationBySlug } from "@/lib/payload";
import { LexicalRichText } from "@/lib/lexical-to-html";
import { payloadDocAttrs, payloadFieldAttrs } from "@/lib/payload-attrs";

type Params = { slug: string };
type Props = { params: Promise<Params> };

const SAMPLE_GALLERY = [
  { src: "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1200&q=80", alt: "Storage facility exterior" },
  { src: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1200&q=80", alt: "Storage unit interior" },
  { src: "https://images.unsplash.com/photo-1594819047050-99defe213a55?w=1200&q=80", alt: "Drive-up storage units" },
];

export async function generateStaticParams(): Promise<Params[]> {
  // Payload is the source of truth for which storage-locations exist.
  // Slugs double as FMS identifiers — the same value the FMS loader uses.
  const editorial = await fetchLocations(200);
  const singles = editorial.filter((l) => l.locationType === "single");
  if (singles.length === 0) return [{ slug: "_placeholder" }];
  return singles.map((l) => ({ slug: l.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (slug === "_placeholder") return { title: "Location" };
  const editorial = await fetchLocationBySlug(slug);
  const facility = await getFacility(slug);
  const name = editorial?.title ?? facility?.name ?? "Location";
  const city = facility?.address.city ?? editorial?.city ?? "";
  const state = facility?.address.state ?? editorial?.state ?? "";
  return {
    title: editorial?.meta?.title ?? `${name} — ${city}, ${state}`,
    description:
      editorial?.meta?.description ??
      (facility
        ? `Self-storage at ${facility.address.line1}, ${facility.address.city}.${facility.phone ? ` Call ${facility.phone}.` : ""}`
        : undefined),
  };
}

export default async function StorageLocationDetailPage({ params }: Props) {
  const { slug } = await params;
  if (slug === "_placeholder") {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight" data-role="heading-2">Locations</h1>
        <p className="mt-4 text-zinc-600" data-role="text">
          No locations are configured yet. Add a location record in your CMS to publish it here.
        </p>
      </main>
    );
  }

  // Payload editorial (title, description, SEO) + FMS operational data
  // (hours, address, amenities) join on the shared slug.
  const editorial = await fetchLocationBySlug(slug);
  const facility = await getFacility(slug);
  if (!editorial && !facility) notFound();

  const name = editorial?.title ?? facility?.name ?? "Location";
  const subheading = facility
    ? `${facility.address.city}, ${facility.address.state}`
    : [editorial?.city, editorial?.state].filter(Boolean).join(", ");
  const features = facility?.amenities.map((feat) => ({ name: feat })) ?? [];

  return (
    <>
      <section
        data-nocms-component="facility-header"
        {...(editorial && payloadDocAttrs({ collection: "locations", docId: editorial.id }))}
        className="bg-surface py-10 lg:py-14"
      >
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <Breadcrumbs
            items={[{ label: "Locations", href: "/storage-locations" }, { label: name }]}
            className="mb-6"
          />
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-6">
            <div>
              <h1
                data-role="heading"
                {...(editorial && payloadFieldAttrs({ collection: "locations", docId: editorial.id, field: "title" }))}
                className="font-heading text-4xl lg:text-5xl font-bold text-text leading-tight"
              >
                {name}
              </h1>
              {subheading && (
                <p data-role="subheading" className="mt-3 text-lg text-muted">
                  {subheading}
                </p>
              )}
            </div>
            {facility && (
              <a
                href={`/storage-locations/${facility.slug}/unit-groups`}
                data-role="cta"
                className="inline-flex items-center justify-center bg-primary text-white font-semibold px-6 py-3 rounded-md shadow-md hover:opacity-90 transition-opacity"
              >
                See available units
              </a>
            )}
          </div>
          {facility && (
            <div className="mt-6">
              <FacilityContactInfo facility={facility} />
            </div>
          )}
        </div>
      </section>

      {editorial?.description && (
        <section className="py-12 lg:py-16 bg-background">
          <div
            className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8"
            {...payloadFieldAttrs({ collection: "locations", docId: editorial.id, field: "description" })}
          >
            <LexicalRichText
              value={editorial.description}
              className="text-text leading-relaxed prose prose-lg max-w-none"
            />
          </div>
        </section>
      )}

      {facility && (
        <>
          <section className="py-12 lg:py-16 bg-background">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
              <FacilityGallery
                images={SAMPLE_GALLERY}
                facilityName={name}
                heading="Inside the facility"
              />
            </div>
          </section>

          <section className="py-12 lg:py-16 bg-surface">
            <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-10">
                <div className="lg:col-span-2">
                  {features.length > 0 && (
                    <FacilityFeatures
                      features={features}
                      content={"## Facility features"}
                    />
                  )}
                </div>
                <div>
                  <FacilityHours hours={facility.hours} />
                </div>
              </div>
            </div>
          </section>

          <CTABanner
            heading={`Reserve a unit at ${name}`}
            subheading="Lock in today's rate online — no payment due now."
            primaryCta={{ label: "See available units", href: `/storage-locations/${facility.slug}/unit-groups` }}
            phone={facility.phone ?? undefined}
          />
        </>
      )}
    </>
  );
}
