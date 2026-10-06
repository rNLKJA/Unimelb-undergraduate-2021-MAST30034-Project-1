import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MOCK_SQL, PLACEHOLDER_KEY, mockSqlAnswer } from "../../e2e/mock-ai";
import { runReadOnly } from "@/server/sql-guard";
import { SqlAnswerSchema } from "./ai/sql-assistant";
import {
  MOCK_PREFIX,
  SCREENSHOTS,
  TOUR_QUESTION,
  WALKTHROUGHS,
  screenshotSrc,
  thumbnailSrc,
  walkthroughMedia,
} from "./showcase";
import { NAV, SITE } from "./site";

const WEB = process.cwd();
const ROOT = path.resolve(WEB, "..");
const PUBLIC = path.join(WEB, "public");
const DOCS_SHOWCASE = path.join(ROOT, "docs", "showcase");
const README = readFileSync(path.join(ROOT, "README.md"), "utf8");
const PRODUCTION = "https://mast30034-nyc-taxi.vercel.app";

const KB = 1024;
const MB = 1024 * KB;
const publicFile = (src: string) => path.join(PUBLIC, src);

describe("showcase definitions", () => {
  it("number the screenshots 01, 02, ... with unique kebab-case names", () => {
    SCREENSHOTS.forEach((s, i) => {
      expect(s.id).toMatch(/^\d{2}-[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(s.id.slice(0, 2)).toBe(String(i + 1).padStart(2, "0"));
      expect(s.id.includes("mobile")).toBe(s.viewport === "mobile");
    });
    expect(new Set(SCREENSHOTS.map((s) => s.id)).size).toBe(SCREENSHOTS.length);
    expect(SCREENSHOTS[0].id).toBe("01-landing-light");
    expect(SCREENSHOTS[1].id).toBe("02-landing-dark");
    const mobile = SCREENSHOTS.filter((s) => s.viewport === "mobile").length;
    expect(mobile).toBeGreaterThanOrEqual(2);
    expect(mobile).toBeLessThanOrEqual(3);
  });

  it("give every walkthrough distinct steps and site routes", () => {
    expect(WALKTHROUGHS.map((w) => w.id)).toEqual([
      "where-and-when",
      "estimate-a-trip",
      "what-changes-trip-time",
    ]);
    for (const w of WALKTHROUGHS) {
      expect(w.steps.length).toBeGreaterThan(3);
      expect(new Set(w.steps).size).toBe(w.steps.length);
      for (const r of w.routes) expect(r.startsWith("/")).toBe(true);
      // the walkthroughs use no AI, so none of them shows a mocked reply
      expect(w.mockedSteps).toBeUndefined();
    }
  });

  it("put the tour in the navigation", () => {
    expect(NAV.some((n) => n.href === "/tour")).toBe(true);
  });
});

describe("the mocked AI reply used for the screenshots", () => {
  it("is typed with a placeholder that is not a credential", () => {
    expect(PLACEHOLDER_KEY).not.toMatch(/^sk-/);
  });

  it("proposes SQL that the site's guard runs, and says it is a mock", async () => {
    const reply = SqlAnswerSchema.parse(mockSqlAnswer(`Question: ${TOUR_QUESTION}`));
    expect(reply.answerable).toBe(true);
    expect(reply.sql).toBe(MOCK_SQL);
    expect(reply.explanation.startsWith(MOCK_PREFIX)).toBe(true);
    const run = await runReadOnly(reply.sql);
    expect(run.columns).toEqual(["pickup_zone", "dropoff_zone", "trips"]);
    expect(run.rows).toHaveLength(10);
    expect(run.rows[0].slice(0, 2)).toEqual(["Upper East Side South", "Upper East Side North"]);
  });

  it("declines anything else, still labelled", () => {
    const reply = SqlAnswerSchema.parse(mockSqlAnswer("Question: Which borough had the most collisions?"));
    expect(reply.answerable).toBe(false);
    expect(reply.sql).toBe("");
    expect(reply.explanation.startsWith(MOCK_PREFIX)).toBe(true);
  });
});

describe("showcase media (pnpm showcase)", () => {
  it("has a PNG under 600 KB, a WebP copy and a thumbnail for every screenshot", () => {
    for (const s of SCREENSHOTS) {
      const png = path.join(DOCS_SHOWCASE, `${s.id}.png`);
      expect(existsSync(png), png).toBe(true);
      expect(statSync(png).size, png).toBeLessThan(600 * KB);
      expect(existsSync(publicFile(screenshotSrc(s.id))), s.id).toBe(true);
      expect(existsSync(publicFile(thumbnailSrc(s.id))), s.id).toBe(true);
    }
  });

  it("has an MP4 and a GIF of at most 8 MB, a poster and captions for every walkthrough", () => {
    for (const w of WALKTHROUGHS) {
      const media = walkthroughMedia(w.id);
      const mp4 = publicFile(media.mp4);
      const gif = path.join(DOCS_SHOWCASE, `${w.id}.gif`);
      for (const file of [mp4, gif]) {
        expect(existsSync(file), file).toBe(true);
        expect(statSync(file).size, file).toBeLessThanOrEqual(8 * MB);
      }
      expect(existsSync(publicFile(media.poster)), media.poster).toBe(true);
    }
  });

  it("captions every step of each video, in order, with the on-screen text", () => {
    for (const w of WALKTHROUGHS) {
      const vtt = readFileSync(publicFile(walkthroughMedia(w.id).captions), "utf8");
      expect(vtt.startsWith("WEBVTT")).toBe(true);
      const cues = [...vtt.matchAll(/^Step (\d+) of (\d+)\. (.*)$/gm)];
      expect(cues.map((m) => Number(m[1]))).toEqual(w.steps.map((_, i) => i + 1));
      cues.forEach((m, i) => {
        expect(Number(m[2])).toBe(w.steps.length);
        expect(m[3]).toBe(`${w.steps[i]}.`);
      });
    }
  });
});

describe("README showcase section", () => {
  it("shows every screenshot and links the tour", () => {
    for (const s of SCREENSHOTS) expect(README).toContain(`docs/showcase/${s.id}.png`);
    expect(README).toContain(`${PRODUCTION}/tour`);
    expect(SITE.repo).toContain("Unimelb-undergraduate-2021-MAST30034-Project-1");
  });

  it("lists each walkthrough's steps exactly as the videos caption them", () => {
    for (const w of WALKTHROUGHS) {
      expect(README).toContain(`docs/showcase/${w.id}.gif`);
      w.steps.forEach((step, i) => expect(README).toContain(`${i + 1}. ${step}`));
    }
  });
});
