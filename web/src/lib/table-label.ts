/** The parts of a hast (HTML syntax tree) node that a markdown table label needs. */
export interface HastLike {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastLike[];
}

function textOf(node: HastLike): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/**
 * Accessible name for a markdown table that has no caption, built from its column headers
 * ("Table: Source, Used for, Version and notes"), so that two tables on one page get
 * different names.
 */
export function markdownTableLabel(table: HastLike | undefined): string {
  const columns: string[] = [];
  const walk = (node: HastLike) => {
    if (node.type === "element" && node.tagName === "th") {
      const text = textOf(node).replace(/\s+/g, " ").trim();
      if (text) columns.push(text);
    } else node.children?.forEach(walk);
  };
  if (table) walk(table);
  return columns.length ? `Table: ${columns.join(", ")}` : "Table";
}
