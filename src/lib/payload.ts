/**
 * Payload CMS fetch helpers. Reads `PAYLOAD_BASE_URL` and `PAYLOAD_API_KEY`
 * from the environment (injected by the nocms preview manager and the
 * Cloudflare Pages build env).
 *
 * Calls return `[]` / `null` when env is missing or the request fails, so the
 * site builds even without Payload reachable. `generateStaticParams` callers
 * should treat an empty list as "no params yet" and fall through to the
 * placeholder branch.
 */

const BASE_URL = process.env.PAYLOAD_BASE_URL;
const API_KEY = process.env.PAYLOAD_API_KEY;

interface PayloadMedia {
  id: string;
  url?: string;
  filename?: string;
  alt?: string;
  width?: number;
  height?: number;
  sizes?: Record<string, { url?: string; width?: number; height?: number }>;
}

export interface PayloadPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string;
  featuredImage?: PayloadMedia | string | null;
  content?: LexicalRoot;
  publishedAt?: string;
  meta?: { title?: string; description?: string; indexable?: boolean };
  updatedAt: string;
}

/** Atomic block shape — every block on a Page is one of these. Fields are
 *  optional; each renderer reads only the subset it needs. Visual variants
 *  are distinguished by `blockType` (the slug) and resolved to a component
 *  via `src/components/blocks/registry.ts`. */
export interface PayloadAtomicBlock {
  id: string;
  blockType: string;
  blockName?: string | null;
  title?: string | null;
  body?: LexicalRoot | null;
  media?: PayloadMedia | string | null;
  mediaArray?: (PayloadMedia | string)[] | null;
}

export interface PayloadPage {
  id: string;
  title: string;
  slug: string;
  blocks?: PayloadAtomicBlock[];
  content?: LexicalRoot;
  meta?: { title?: string; description?: string; indexable?: boolean };
  updatedAt: string;
}

export interface PayloadLocation {
  id: string;
  title: string;
  slug: string;
  locationType: "single" | "city" | "state";
  city?: string;
  state?: string;
  address?: {
    street?: string;
    unit?: string;
    postalCode?: string;
    country?: string;
    phone?: string;
    email?: string;
  };
  coordinates?: [number, number];
  description?: LexicalRoot;
  parent?: PayloadLocation | string | null;
  meta?: { title?: string; description?: string; indexable?: boolean };
  updatedAt: string;
}

// Minimal Lexical shape — enough for the simple renderer in this template.
export interface LexicalNode {
  type: string;
  tag?: string;
  text?: string;
  format?: number | string;
  url?: string;
  listType?: "number" | "bullet" | "check";
  value?: number;
  fields?: { url?: string; newTab?: boolean };
  children?: LexicalNode[];
}
export interface LexicalRoot {
  root: { type: "root"; children: LexicalNode[] };
}

interface PayloadListResponse<T> {
  docs: T[];
  totalDocs: number;
  hasNextPage: boolean;
}

async function payloadFetch<T>(path: string): Promise<T | null> {
  if (!BASE_URL) return null;
  const url = `${BASE_URL.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `users API-Key ${API_KEY}`;
  try {
    // No caching. The live preview iframe re-loads after every CMS write —
    // that re-load is the only "trigger" we need. No tags, no /api/revalidate
    // route, no webhook from nocms. Static builds (`next build`) snapshot at
    // build time; a fresh deploy is the equivalent trigger there.
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// Draft mode: in dev (the nocms preview), surface the latest drafts so edits
// made via the CMS panel show up on the next iframe reload — published-only
// fetches would lag a publish action. In production, fetch published docs.
const DRAFT_QS = process.env.NODE_ENV === "production" ? "" : "&draft=true";

export async function fetchPages(limit = 100): Promise<PayloadPage[]> {
  const res = await payloadFetch<PayloadListResponse<PayloadPage>>(
    `/cms/api/pages?limit=${limit}&depth=2${DRAFT_QS}`,
  );
  return res?.docs ?? [];
}

export async function fetchPageBySlug(slug: string): Promise<PayloadPage | null> {
  const res = await payloadFetch<PayloadListResponse<PayloadPage>>(
    `/cms/api/pages?where[slug][equals]=${encodeURIComponent(slug)}&limit=1&depth=2${DRAFT_QS}`,
  );
  return res?.docs[0] ?? null;
}

export async function fetchPosts(limit = 50): Promise<PayloadPost[]> {
  const res = await payloadFetch<PayloadListResponse<PayloadPost>>(
    `/cms/api/posts?limit=${limit}&depth=1&sort=-publishedAt${DRAFT_QS}`,
  );
  return res?.docs ?? [];
}

export async function fetchPostBySlug(slug: string): Promise<PayloadPost | null> {
  const res = await payloadFetch<PayloadListResponse<PayloadPost>>(
    `/cms/api/posts?where[slug][equals]=${encodeURIComponent(slug)}&limit=1&depth=1${DRAFT_QS}`,
  );
  return res?.docs[0] ?? null;
}

export async function fetchLocations(limit = 100): Promise<PayloadLocation[]> {
  const res = await payloadFetch<PayloadListResponse<PayloadLocation>>(
    `/cms/api/locations?limit=${limit}&depth=1&sort=title${DRAFT_QS}`,
  );
  return res?.docs ?? [];
}

export async function fetchLocationBySlug(slug: string): Promise<PayloadLocation | null> {
  const res = await payloadFetch<PayloadListResponse<PayloadLocation>>(
    `/cms/api/locations?where[slug][equals]=${encodeURIComponent(slug)}&limit=1&depth=1${DRAFT_QS}`,
  );
  return res?.docs[0] ?? null;
}

export function mediaUrl(media: PayloadMedia | string | null | undefined): string | null {
  if (!media) return null;
  if (typeof media === "string") return media;
  return media.sizes?.feature?.url ?? media.sizes?.card?.url ?? media.url ?? null;
}

export function mediaAlt(media: PayloadMedia | string | null | undefined): string {
  if (!media || typeof media === "string") return "";
  return media.alt ?? media.filename ?? "";
}

/** Pull a list of media URLs from an atomic block's `mediaArray`. */
export function mediaArrayUrls(refs: (PayloadMedia | string)[] | null | undefined): { url: string; alt: string }[] {
  if (!refs) return [];
  return refs
    .map((m) => ({ url: mediaUrl(m), alt: mediaAlt(m) }))
    .filter((m): m is { url: string; alt: string } => Boolean(m.url));
}

/** Shape consumed by `<BlogCard />` and `<BlogArchiveWrapper />`. */
export interface BlogCardPost {
  slug: string;
  title: string;
  excerpt: string;
  publishedAt: string;
  coverImage?: { src: string; alt: string };
  category?: string;
}

export function toCardPost(post: PayloadPost): BlogCardPost {
  const cover = mediaUrl(post.featuredImage);
  return {
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt ?? "",
    publishedAt: post.publishedAt ?? post.updatedAt,
    coverImage: cover ? { src: cover, alt: mediaAlt(post.featuredImage) || post.title } : undefined,
  };
}
