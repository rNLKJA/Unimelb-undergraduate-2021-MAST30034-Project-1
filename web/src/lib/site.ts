export const SITE = {
  name: "NYC Taxi 2019",
  title: "NYC Taxi 2019: Where, When and How Long",
  description:
    "An interactive revival of MAST30034 Applied Data Science Project 1 (University of Melbourne, 2021): 84 million New York yellow-taxi trips cleaned, mapped and modelled.",
  repo: "https://github.com/rNLKJA/Unimelb-undergraduate-2021-MAST30034-Project-1",
  author: "Sunchuangyu (Rin) Huang",
} as const;

export interface NavItem {
  href: string;
  label: string;
  /** other routes that highlight this item */
  also?: readonly string[];
}

export const NAV: readonly NavItem[] = [
  { href: "/map", label: "Zone map" },
  { href: "/routes", label: "Routes" },
  { href: "/conditions", label: "Conditions" },
  { href: "/estimate", label: "Estimate" },
  { href: "/evaluation", label: "Evaluation" },
  { href: "/effects", label: "Effects" },
  { href: "/ask", label: "Ask the data" },
  { href: "/methods", label: "Methods", also: ["/method", "/data-quality", "/ai-log"] },
  { href: "/records", label: "Records" },
  { href: "/tour", label: "Tour" },
];

type Env = Record<string, string | undefined>;

/**
 * Canonical origin for metadata and Open Graph URLs.
 *
 * NEXT_PUBLIC_SITE_URL wins when set. Otherwise this follows Next.js's own
 * fallback chain: on Vercel, the production domain for production builds and
 * the branch/deployment URL for previews (Vercel exposes these system variables
 * at build time); locally, http://localhost:$PORT.
 */
export function siteUrl(env: Env = process.env): URL {
  if (env.NEXT_PUBLIC_SITE_URL) return new URL(env.NEXT_PUBLIC_SITE_URL);
  const host =
    env.VERCEL_ENV === "preview"
      ? (env.VERCEL_BRANCH_URL ?? env.VERCEL_URL)
      : (env.VERCEL_PROJECT_PRODUCTION_URL ?? env.VERCEL_URL);
  if (host) return new URL(`https://${host}`);
  return new URL(`http://localhost:${env.PORT ?? 3000}`);
}

/** GitHub URL of a path in the repository (main branch). */
export function repoPath(path: string): string {
  return `${SITE.repo}/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function repoTree(path: string): string {
  return `${SITE.repo}/tree/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}
