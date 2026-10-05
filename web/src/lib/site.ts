export const SITE = {
  name: "NYC Taxi 2019",
  title: "NYC Taxi 2019: Where, When and How Long",
  description:
    "An interactive revival of MAST30034 Applied Data Science Project 1 (University of Melbourne, 2021): 84 million New York yellow-taxi trips cleaned, mapped and modelled.",
  repo: "https://github.com/rNLKJA/Unimelb-undergraduate-2021-MAST30034-Project-1",
  author: "Sunchuangyu (Rin) Huang",
} as const;

export const NAV = [
  { href: "/map", label: "Zone map" },
  { href: "/routes", label: "Routes" },
  { href: "/conditions", label: "Conditions" },
  { href: "/estimate", label: "Estimate a trip" },
  { href: "/method", label: "Method" },
  { href: "/records", label: "Records" },
] as const;

/** GitHub URL of a path in the repository (main branch). */
export function repoPath(path: string): string {
  return `${SITE.repo}/blob/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function repoTree(path: string): string {
  return `${SITE.repo}/tree/main/${path.split("/").map(encodeURIComponent).join("/")}`;
}
