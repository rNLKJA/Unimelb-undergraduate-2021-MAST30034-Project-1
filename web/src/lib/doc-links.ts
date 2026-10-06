/** Map links between the markdown files in docs/ to website routes. */
export function docHref(href: string): string {
  if (/^[a-z]+:/i.test(href) || href.startsWith("/") || href.startsWith("#")) return href;
  const dr = /(?:^|\/)(DR-\d{3}-[\w-]+)\.md(#.*)?$/.exec(href);
  if (dr) return `/methods/decisions/${dr[1]}${dr[2] ?? ""}`;
  if (/(?:^|\/)model-card\.md$/.test(href)) return "/methods#model-card";
  if (/(?:^|\/)ai-use-statement\.md$/.test(href)) return "/methods#ai-use";
  if (/(?:^|\/)methods\.md$/.test(href)) return "/methods";
  return href;
}

/** Heading id: lower case, words joined by hyphens ("Evaluation design" -> "evaluation-design"). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
