import { describe, expect, it } from "vitest";
import { markdownTableLabel, type HastLike } from "./table-label";

const text = (value: string): HastLike => ({ type: "text", value });
const el = (tagName: string, ...children: HastLike[]): HastLike => ({ type: "element", tagName, children });

describe("markdownTableLabel", () => {
  it("names a table by its column headers, including formatted ones", () => {
    // the hast that remark-gfm + remark-rehype produce for a three-column table
    const table = el(
      "table",
      text("\n"),
      el(
        "thead",
        el(
          "tr",
          el("th", text("Source")),
          el("th", text("Used  for")),
          el("th", el("strong", text("Version")), text(" and "), el("code", text("notes"))),
        ),
      ),
      el("tbody", el("tr", el("td", text("a")), el("td", text("b")), el("td", text("c")))),
    );
    expect(markdownTableLabel(table)).toBe("Table: Source, Used for, Version and notes");
  });

  it("falls back to a plain name without headers", () => {
    expect(markdownTableLabel(undefined)).toBe("Table");
    expect(markdownTableLabel(el("table", el("tbody")))).toBe("Table");
    expect(markdownTableLabel(el("table", el("thead", el("tr", el("th")))))).toBe("Table");
  });
});
