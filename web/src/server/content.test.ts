import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docHref, getDecision, listDecisions, parseDecision, readDoc } from "./content";

const docs = path.resolve(process.cwd(), "..", "docs");

describe("rendered documents", () => {
  it.skipIf(!existsSync(docs))("web/content is an exact copy of docs/ (run `pnpm docs:sync`)", () => {
    const pairs: [string, string][] = ["methods.md", "model-card.md", "ai-use-statement.md"].map((f) => [
      path.join(docs, f),
      path.join("content", f),
    ]);
    const drs = readdirSync(path.join(docs, "decisions")).filter((f) => f.startsWith("DR-"));
    expect(readdirSync(path.join("content", "decisions")).sort()).toEqual(drs.sort());
    for (const f of drs) pairs.push([path.join(docs, "decisions", f), path.join("content", "decisions", f)]);
    for (const [a, b] of pairs) expect(readFileSync(b, "utf8"), b).toBe(readFileSync(a, "utf8"));
  });

  it("parses every decision record in Rin's format", () => {
    const all = listDecisions();
    expect(all.map((d) => d.id)).toEqual(["DR-001", "DR-002", "DR-003", "DR-004"]);
    for (const d of all) {
      expect(d.status, d.id).toBe("Accepted");
      expect(d.decision.length, d.id).toBeGreaterThan(40);
      const headings = [...d.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
      expect(headings, d.id).toEqual([
        "Context",
        "Decision",
        "Options considered",
        "Why",
        "What happened",
        "What I'd change",
      ]);
    }
    expect(getDecision("DR-003-conformal-intervals")!.title).toMatch(/conformal/i);
    expect(getDecision("nope")).toBeNull();
    expect(() => parseDecision("x", "no heading")).toThrow();
  });

  it("keeps the house style: no spaced em dashes", () => {
    const texts = [
      readDoc("methods"),
      readDoc("model-card"),
      readDoc("ai-use-statement"),
      ...listDecisions().map((d) => d.body),
    ];
    for (const t of texts) expect(t).not.toContain(" — ");
  });

  it("maps links between documents to site routes", () => {
    expect(docHref("decisions/DR-002-cleaning-thresholds.md")).toBe(
      "/methods/decisions/DR-002-cleaning-thresholds",
    );
    expect(docHref("DR-004-byok-text-to-sql.md#why")).toBe("/methods/decisions/DR-004-byok-text-to-sql#why");
    expect(docHref("../model-card.md")).toBe("/methods#model-card");
    expect(docHref("/evaluation")).toBe("/evaluation");
    expect(docHref("https://example.com")).toBe("https://example.com");
  });
});
