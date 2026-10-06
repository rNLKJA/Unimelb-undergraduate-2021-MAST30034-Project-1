/**
 * The guided tour, as an end-to-end test.
 *
 *   pnpm showcase                                   # production, records media
 *   BASE_URL=http://localhost:3000 pnpm showcase    # a local `pnpm build` first
 *   pnpm showcase:test                              # journeys only: no pauses, no video
 *
 * Each journey checks what it shows (the hourly pickup totals, the busiest
 * zones, JFK's median trip at two hours, the prediction and its conformal
 * interval at two levels and two hours, the rain and event effects with their
 * intervals, the data-quality counts), so a broken feature or a changed figure
 * fails the tour instead of producing a misleading video. Inputs are fixed and
 * every figure on these pages is either a full count or uses the site's fixed
 * bootstrap seed (20190101), so a re-run shows the same numbers.
 *
 * No real API key is used: the AI screenshots type a placeholder, and every
 * request to a provider is answered in the browser by e2e/mock-ai.ts.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { type Browser, type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";

import {
  MOCK_LABEL,
  MOCK_MODEL_ID,
  MOCK_PREFIX,
  SCREENSHOTS,
  TOUR_QUESTION,
  WALKTHROUGHS,
  type WalkthroughId,
  walkthroughMedia,
} from "../src/lib/showcase";
import { MOCK_SQL, PLACEHOLDER_KEY, mockAiProviders } from "./mock-ai";
import { FAST, SHOT_DIR, Tour, ensureDirs, finishRecording, recordingContext } from "./showcase-helpers";

const PUBLIC_DIR = path.resolve(import.meta.dirname, "..", "public");

const walkthrough = (id: WalkthroughId) => WALKTHROUGHS.find((w) => w.id === id)!;

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

/** Wait for a MapLibre map (role=region) to finish loading, plus a moment for basemap tiles. */
async function mapReady(page: Page, region: Locator) {
  await expect(region.locator("canvas.maplibregl-canvas")).toBeVisible({ timeout: 30_000 });
  await expect(region).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(FAST ? 200 : 1500);
}

/**
 * Viewport screenshot to .showcase/screens/<id>.png, optionally with `align`
 * scrolled to `offset` px from the top (applied twice, after layout settles).
 */
async function shot(page: Page, id: string, align?: { target: Locator; offset: number }) {
  if (!SCREENSHOTS.some((s) => s.id === id)) throw new Error(`Unknown screenshot ${id}`);
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  for (let i = 0; i < 2; i++) {
    if (align) {
      await align.target.evaluate((el, offset) => {
        const top = el.getBoundingClientRect().top + window.scrollY - offset;
        window.scrollTo({ top, behavior: "instant" });
      }, align.offset);
    }
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: path.join(SHOT_DIR, `${id}.png`) });
}

/** A visible "mocked" label pinned to the page, for screenshots of mocked AI output. */
async function pinMockLabel(page: Page) {
  await page.evaluate((label) => {
    const el = document.createElement("div");
    el.textContent = label;
    el.setAttribute("aria-hidden", "true");
    el.style.cssText =
      "position:fixed;right:24px;bottom:24px;z-index:2147483647;padding:8px 14px;border-radius:12px;" +
      "background:#fff3d6;color:#5a3b00;border:2px dashed #b07a00;font:700 15px/1.2 ui-sans-serif,system-ui,sans-serif;" +
      "text-transform:uppercase;letter-spacing:.04em;box-shadow:0 8px 24px rgba(0,0,0,.18)";
    document.body.appendChild(el);
  }, MOCK_LABEL);
}

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const heading = (page: Page, name: string | RegExp) =>
  page.getByRole("heading", { name, exact: typeof name === "string" });
const radio = (scope: Page | Locator, name: string) => scope.getByRole("radio", { name, exact: true });

// ------------------------------------------------------------------ zone map

const zoneMap = {
  region: (page: Page) => page.getByRole("region", { name: /^Choropleth of / }),
  controls: (page: Page) => page.getByRole("complementary", { name: "Map controls" }),
  hour: (page: Page) => page.getByRole("slider", { name: "Hour of day" }),
  hourReadout: (page: Page) => zoneMap.controls(page).locator("span[aria-live='polite']"),
  ranked: (page: Page) => zoneMap.controls(page).locator("ol").first(),
  stat: (page: Page, label: string) =>
    zoneMap.controls(page).locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]"),
};

/** Sum of the hour's bars, as the scrubber's tooltip shows it (e.g. "4 am: 558K trips"). */
async function expectHourBar(page: Page, hour: string, total: string) {
  await expect(zoneMap.controls(page).locator(`button[title="${hour}: ${total} trips"]`)).toHaveCount(1);
}

/** The x coordinate of value `v` on a native range input spanning 0..max. */
function rangeX(box: { x: number; width: number }, v: number, max: number) {
  const thumb = 8; // half of Chrome's 16 px range thumb
  return box.x + thumb + ((box.width - 2 * thumb) * v) / max;
}

/** Drag the hour slider through `hours`, pausing at each, then make sure it landed on the last. */
async function scrubHours(tour: Tour, page: Page, from: number, hours: readonly number[]) {
  const slider = zoneMap.hour(page);
  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await tour.glide(rangeX(box, from, 23), y, 700);
  await tour.pause(300);
  await page.mouse.down();
  for (const h of hours) {
    await tour.glide(rangeX(box, h, 23), y, 1400);
    await tour.pause(900);
  }
  await page.mouse.up();
  const last = hours[hours.length - 1];
  if ((await slider.inputValue()) !== String(last)) await slider.fill(String(last));
  await expect(slider).toHaveValue(String(last));
}

// ------------------------------------------------------------------ estimate

const estimate = {
  result: (page: Page) => page.locator("section[aria-labelledby='result-h']"),
  band: (page: Page) => page.getByRole("img", { name: /^Prediction [\d.]+ minutes, \d+% interval/ }),
};

// ------------------------------------------------------------- ask the data

async function addPlaceholderKey(page: Page, type: (target: Locator, text: string) => Promise<void>) {
  const dialog = page.getByRole("dialog", { name: "AI settings" });
  await expect(dialog).toBeVisible();
  await type(dialog.getByLabel("Anthropic API key"), PLACEHOLDER_KEY);
  return dialog;
}

test.beforeAll(() => ensureDirs());

test.describe("journeys (recorded)", () => {
  test("1. where and when: hour and weekday on the zone map, JFK's detail, its routes", async ({
    browser,
  }) => {
    test.setTimeout(8 * 60_000);
    const id = "where-and-when";
    const context = await recordingContext(browser);
    const page = await context.newPage();
    const tour = new Tour(page, walkthrough(id));
    const controls = zoneMap.controls(page);

    await page.goto("/map");
    await expect(h1(page)).toHaveText("Where the cabs go");
    await tour.idleWhile(() => mapReady(page, zoneMap.region(page)));
    await settle(page);
    tour.markStart();

    // 1. The default view: pickups, all days, 6 pm.
    await tour.caption(1, { align: "map" });
    await expect(zoneMap.hourReadout(page)).toHaveText("6 pm–7 pm");
    await expect(radio(controls, "Pickups")).toHaveAttribute("aria-checked", "true");
    await tour.pause(1200);
    const mapBox = (await zoneMap.region(page).boundingBox())!;
    // Across Manhattan, then out to Queens.
    await tour.glide(mapBox.x + mapBox.width * 0.55, mapBox.y + mapBox.height * 0.36, 1100);
    await tour.pause(1300);
    await tour.glide(mapBox.x + mapBox.width * 0.7, mapBox.y + mapBox.height * 0.5, 900);
    await tour.pause(1100);
    await tour.hover(zoneMap.ranked(page), 900);
    await tour.pause(1200);

    // 2. Scrub to 4 am: the quietest hour.
    await tour.caption(2, { align: "map" });
    await expectHourBar(page, "4 am", "558.5K");
    await expectHourBar(page, "6 pm", "4.9M");
    await scrubHours(tour, page, 18, [12, 4]);
    await expect(zoneMap.hourReadout(page)).toHaveText("4 am–5 am");
    await tour.pause(1800);

    // 3. On to 8 am: the Upper East Side leads.
    await tour.caption(3, { align: "map" });
    await scrubHours(tour, page, 4, [8]);
    await expect(zoneMap.hourReadout(page)).toHaveText("8 am–9 am");
    await expect(zoneMap.ranked(page).locator("li").first()).toContainText("Upper East Side North");
    await tour.hover(zoneMap.ranked(page).locator("li").first(), 800);
    await tour.pause(2000);

    // 4. Saturday at 1 am.
    await tour.caption(4, { align: "map" });
    await tour.click(radio(controls, "Sat"));
    await tour.idleWhile(() => expect(controls.getByText(/Saturdays in 2019/)).toBeVisible());
    await scrubHours(tour, page, 8, [1]);
    await expect(zoneMap.hourReadout(page)).toHaveText("1 am–2 am");
    await expect(zoneMap.ranked(page).locator("li").nth(0)).toContainText("East Village");
    await expect(zoneMap.ranked(page).locator("li").nth(1)).toContainText("Lower East Side");
    await tour.glide(mapBox.x + mapBox.width * 0.47, mapBox.y + mapBox.height * 0.5, 900);
    await tour.pause(1200);
    await tour.hover(zoneMap.ranked(page).locator("li").nth(1), 800);
    await tour.pause(1800);

    // 5. All days, 3 pm, coloured by median minutes.
    await tour.caption(5, { align: "map" });
    await tour.click(radio(controls, "All"));
    await tour.idleWhile(() => expect(controls.getByText(/all of 2019/)).toBeVisible());
    await scrubHours(tour, page, 1, [15]);
    await tour.click(radio(controls, "Median minutes"));
    await expect(controls.getByText(/^Slowest median trips/)).toBeVisible();
    const jfkRow = zoneMap.ranked(page).getByRole("button").filter({ hasText: "JFK Airport" });
    await expect(jfkRow).toContainText("51.8 min");
    await tour.glide(mapBox.x + mapBox.width * 0.78, mapBox.y + mapBox.height * 0.66, 1100);
    await tour.pause(1400);
    await tour.hover(jfkRow, 900);
    await tour.pause(1200);

    // 6. Open JFK Airport.
    await tour.caption(6, { align: "map" });
    await tour.click(jfkRow);
    await expect(heading(page, "JFK Airport")).toBeVisible();
    await expect(zoneMap.stat(page, "Median trip")).toHaveText("51.8 min");
    await tour.idleWhile(() => page.waitForTimeout(FAST ? 0 : 1200)); // the map flies to the zone
    await tour.hover(zoneMap.stat(page, "Pickups, 2019"), 800);
    await tour.pause(1200);
    const profile = controls.getByText("24-hour profile (bars: trips)");
    await tour.scrollInside(controls, heading(page, "JFK Airport"), { offset: 12, ms: 900 });
    await tour.hover(profile, 800);
    await tour.pause(1200);
    await tour.hover(controls.getByText(/^Vendor split, 2019/), 800);
    await tour.pause(1300);

    // 7. The 24-hour profile: 1 am against 3 pm.
    await tour.caption(7, { align: "map" });
    const bar = (label: string) =>
      controls.getByRole("button", { name: new RegExp(`^${label}: [\\d,]+ trips`) });
    await tour.click(bar("1 am"), { scroll: false });
    await expect(zoneMap.stat(page, "Median trip")).toHaveText("26.2 min");
    await tour.hover(zoneMap.stat(page, "Median trip"), 700, { scroll: false });
    await tour.pause(1800);
    await tour.click(bar("3 pm"), { scroll: false });
    await expect(zoneMap.stat(page, "Median trip")).toHaveText("51.8 min");
    await tour.hover(zoneMap.stat(page, "Median trip"), 700, { scroll: false });
    await tour.pause(1800);

    // 8. Play the day.
    await tour.caption(8, { align: "map" });
    await tour.scrollInside(controls, zoneMap.hour(page), { offset: 120, ms: 900 });
    const play = controls.getByRole("button", { name: "Play the day" });
    await tour.click(play, { scroll: false });
    await expect(controls.getByRole("button", { name: "Pause" })).toBeVisible();
    await tour.glide(mapBox.x + mapBox.width * 0.5, mapBox.y + mapBox.height * 0.55, 900);
    await tour.pause(5400);
    await tour.click(controls.getByRole("button", { name: "Pause" }), { scroll: false });
    await tour.pause(800);

    // The full-height map page never scrolls as a whole: only its controls panel does.
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    // 9. Routes from JFK Airport.
    await tour.caption(9, { align: "map" });
    const routesLink = controls.getByRole("link", { name: "Routes from JFK Airport" });
    await tour.scrollInside(controls, routesLink, { offset: 300, ms: 900 });
    await tour.click(routesLink, { scroll: false });
    await page.waitForURL(/\/routes\?zone=132/);
    const routesMap = page.getByRole("region", { name: /^Busiest taxi routes from JFK Airport/ });
    await tour.idleWhile(() => mapReady(page, routesMap));
    const routeList = page.getByRole("list", { name: "Top routes from JFK Airport" });
    await expect(routeList.locator("li").first()).toContainText("Times Sq/Theatre District");
    await tour.pause(1200);
    await tour.hover(routeList.locator("li").first(), 900, { scroll: false });
    await tour.pause(1500);
    await tour.hover(routeList.locator("li").nth(2), 800, { scroll: false });
    await tour.pause(1500);
    const routesBox = (await routesMap.boundingBox())!;
    await tour.glide(routesBox.x + routesBox.width * 0.35, routesBox.y + routesBox.height * 0.45, 1000);
    await tour.pause(2600);

    await finishRecording(context, page, tour);
  });

  test("2. estimate a trip: zones, time, a conformal interval, the terms, the coverage check", async ({
    browser,
  }) => {
    test.setTimeout(8 * 60_000);
    const id = "estimate-a-trip";
    const context = await recordingContext(browser);
    const page = await context.newPage();
    const tour = new Tour(page, walkthrough(id));
    const result = estimate.result(page);

    await page.goto("/estimate");
    await expect(h1(page)).toHaveText("How long will it take?");
    await settle(page);
    // The default trip is Midtown Center to JFK at the flat fare.
    await expect(page.locator("#est-rate")).toHaveValue("2");
    tour.markStart();

    // 1.
    await tour.caption(1);
    await tour.pause(1000);
    await tour.hover(h1(page), 900);
    await tour.pause(1300);
    await tour.hover(page.getByText(/^The regression from the 2021 notebook/), 800);
    await tour.pause(1600);

    // 2. Pickup.
    await tour.caption(2);
    const pu = page.locator("#est-pu");
    await tour.click(pu, { after: 200 });
    await pu.selectOption({ label: "Penn Station/Madison Sq West" });
    await tour.pause(1300);

    // 3. Drop-off, date and hour (the date and hour are the defaults).
    await tour.caption(3);
    const dropoff = page.locator("#est-do");
    await tour.click(dropoff, { after: 200 });
    await dropoff.selectOption({ label: "Times Sq/Theatre District" });
    // Leaving the Manhattan-JFK route drops the flat fare.
    await expect(page.locator("#est-rate")).toHaveValue("1");
    await tour.pause(900);
    await expect(page.locator("#est-date")).toHaveValue("2019-10-09");
    await tour.hover(page.locator("#est-date"), 700);
    await tour.pause(900);
    await expect(page.locator("#est-hour")).toHaveValue("17");
    await tour.hover(page.locator("#est-hour"), 700);
    await tour.pause(1100);
    await tour.hover(page.getByText(/^That day, Manhattan/), 800);
    await tour.pause(1300);

    // 4. The prediction and its 90% interval.
    await tour.caption(4);
    await expect(result).toContainText(
      "Penn Station/Madison Sq West → Times Sq/Theatre District, Wednesday at 5 pm",
    );
    await expect(result.getByText("14.2", { exact: false }).first()).toBeVisible();
    await expect(result).toContainText("90% prediction interval: 3.9 to 31.5 min");
    await tour.hover(result.locator("p.font-condensed"), 900);
    await tour.pause(1500);
    await tour.hover(estimate.band(page), 900);
    await tour.pause(1800);

    // 5. What riders saw.
    await tour.caption(5);
    await expect(result).toContainText("13.3 min (9,856 trips)");
    await tour.hover(result.getByText("Observed median, 5 pm"), 800);
    await tour.pause(1600);
    await tour.hover(estimate.band(page), 800);
    await tour.pause(1500);

    // 6. 95%.
    await tour.caption(6);
    await tour.click(radio(result, "95%"));
    await expect(result).toContainText("95% prediction interval: 3.1 to 36.7 min");
    await expect(result).toContainText(/95\.0% fell inside \(95% CI 94\.9% to 95\.1%/);
    await tour.hover(estimate.band(page), 800);
    await tour.pause(1400);
    await tour.hover(result.getByText(/^Split-conformal, from/), 900);
    await tour.pause(2200);

    // 7. 8 am.
    await tour.caption(7);
    const hour = page.locator("#est-hour");
    await tour.click(hour, { after: 200 });
    await hour.selectOption({ label: "8 am" });
    await expect(result).toContainText("Wednesday at 8 am");
    await expect(result.locator("p.font-condensed")).toContainText("13.2");
    await tour.pause(600);
    await tour.hover(result.locator("p.font-condensed"), 800);
    await tour.pause(1300);
    await tour.hover(estimate.band(page), 800);
    await tour.pause(1600);

    // 8. Why that number.
    await tour.caption(8);
    await tour.scrollTo(heading(page, "Why that number"), { offset: 90, ms: 1200 });
    await tour.pause(900);
    const why = page.locator("section[aria-labelledby='why-h']");
    await tour.hover(why.getByText("Pickup zone", { exact: true }), 800);
    await tour.pause(1100);
    await tour.hover(why.getByText("Drop-off zone", { exact: true }), 700);
    await tour.pause(1100);
    await tour.hover(why.getByText("Intercept + all terms", { exact: true }), 800);
    await tour.pause(1600);

    // 9. How the intervals were checked.
    await tour.caption(9);
    await tour.scrollToY(0, 900);
    await tour.pause(400);
    const how = result.getByRole("link", { name: "How the intervals are built" });
    await tour.click(how);
    await page.waitForURL(/\/evaluation#intervals$/);
    await expect(heading(page, "Intervals that hold their coverage")).toBeVisible();
    await settle(page);
    await tour.scrollTo(heading(page, "Intervals that hold their coverage"), { offset: 80, ms: 600 });
    await tour.pause(1200);
    await tour.hover(
      page.getByText(/^Empirical coverage with a 95% interval that resamples whole test days/),
      900,
    );
    await tour.pause(1600);
    const row = page.getByRole("row", { name: /^Mondrian by borough × decile/ }).first();
    await expect(row).toContainText("90.0% (89.9% to 90.1%)");
    await tour.hover(row, 900);
    await tour.pause(2800);

    await finishRecording(context, page, tour);
  });

  test("3. what changes trip time: rain and events with intervals, then data quality", async ({
    browser,
  }) => {
    test.setTimeout(8 * 60_000);
    const id = "what-changes-trip-time";
    const context = await recordingContext(browser);
    const page = await context.newPage();
    const tour = new Tour(page, walkthrough(id));

    await page.goto("/effects");
    await expect(h1(page)).toHaveText("Does rain slow a taxi down?");
    await settle(page);
    tour.markStart();

    // 1.
    await tour.caption(1);
    await tour.pause(1000);
    await tour.hover(h1(page), 900);
    await tour.pause(1300);
    await tour.scrollTo(heading(page, "Compare the same trips, not the same day"), { offset: 90, ms: 1200 });
    await tour.pause(900);
    await tour.hover(page.getByText(/^People ride differently in the rain/), 900);
    await tour.pause(1800);

    // 2. The daily scatter.
    await tour.caption(2);
    const scatter = page.getByRole("img", { name: "Daily duration index against precipitation" }).last();
    await tour.scrollTo(scatter, { offset: 120, ms: 1000 });
    await tour.pause(700);
    const sBox = (await scatter.boundingBox())!;
    await tour.glide(sBox.x + sBox.width * 0.12, sBox.y + sBox.height * 0.5, 900);
    await tour.pause(1100);
    await tour.glide(sBox.x + sBox.width * 0.7, sBox.y + sBox.height * 0.42, 1200);
    await tour.pause(1800);

    // 3. The rain estimate.
    await tour.caption(3);
    await tour.scrollTo(heading(page, /^Rain days: about \d+% slower$/), { offset: 90, ms: 1200 });
    const adjusted = page
      .locator("#rain dt", { hasText: "Same trips, adjusted for month, weekday and holidays" })
      .locator("..");
    await expect(adjusted).toContainText("+3.4%");
    await expect(adjusted).toContainText("95% CI +1.9% to +4.8%");
    await expect(adjusted).toContainText("n = 333 days");
    await expect(adjusted).toContainText("Newey–West (7 lags) +2.0% to +4.8%");
    await tour.pause(700);
    await tour.hover(page.locator("#rain dt", { hasText: "raw" }).locator(".."), 800);
    await tour.pause(1100);
    await tour.hover(adjusted, 900);
    await tour.pause(2400);

    // 4. The CI plot.
    await tour.caption(4);
    const rainPlot = page.locator("#rain").getByRole("img", { name: /^Change in duration index/ });
    const plotRow = (label: string) => rainPlot.locator("div.leading-tight", { hasText: label }).first();
    await tour.scrollTo(rainPlot, { offset: 200, ms: 1100 });
    await tour.pause(700);
    await tour.hover(plotRow("Wet vs dry, regression"), 800);
    await tour.pause(1200);
    await tour.hover(plotRow("1 in or more"), 800);
    await tour.pause(1200);
    await tour.hover(page.getByText("No clear dose response", { exact: true }), 800);
    await tour.pause(1600);

    // 5. Events.
    await tour.caption(5);
    await tour.scrollTo(heading(page, "Event-heavy days, matched"), { offset: 90, ms: 1300 });
    const pairs = page.locator("#events dt", { hasText: /^31 matched pairs on 16 dates$/ }).locator("..");
    await expect(pairs).toContainText("−0.6%");
    await expect(pairs).toContainText("95% CI −2.8% to +1.8%");
    await tour.pause(700);
    await tour.hover(pairs, 900);
    await tour.pause(1800);
    await tour.hover(page.getByText("No detectable effect", { exact: true }), 900);
    await tour.pause(2000);

    // 6. Caveats.
    await tour.caption(6);
    await tour.scrollTo(heading(page, "What these comparisons cannot rule out"), { offset: 90, ms: 1300 });
    await tour.pause(800);
    await tour.hover(page.getByText("Observational data.", { exact: true }), 800);
    await tour.pause(1100);
    await tour.hover(page.getByText("Collisions are a mediator.", { exact: true }), 800);
    await tour.pause(1800);

    // 7. The data-quality report.
    await tour.caption(7);
    await page.goto("/data-quality");
    await expect(h1(page)).toHaveText("What each rule removes, and why");
    await settle(page);
    await tour.pause(900);
    await tour.hover(h1(page), 800);
    await tour.pause(1100);
    await tour.hover(
      page.getByText(/^The 2021 notebook cleaned 84,598,444 raw records down to 74,910,889/),
      900,
    );
    await tour.pause(1800);

    // 8. Missing values.
    await tour.caption(8);
    await tour.scrollTo(heading(page, "The January gap is one column"), { offset: 90, ms: 1200 });
    await expect(page.locator("#missing")).toContainText("5,300,601 rows go");
    await tour.pause(700);
    await tour.hover(page.getByRole("row", { name: /^2019-01 / }), 800);
    await tour.pause(1100);
    await tour.hover(page.getByRole("img", { name: /^Rows per day in January 2019/ }), 900);
    await tour.pause(1800);

    // 9. Rule by rule.
    await tour.caption(9);
    await tour.scrollTo(heading(page, "Removed in sequence, failing alone, failing only this rule"), {
      offset: 90,
      ms: 1300,
    });
    await tour.pause(800);
    const firstRule = page.locator("#rules ol > li").first();
    await tour.hover(firstRule.getByText("Removed in sequence"), 800);
    await tour.pause(900);
    await tour.hover(firstRule.getByText("Only this rule"), 700);
    await tour.pause(1100);
    await tour.scrollTo(page.locator("#rules ol > li").nth(4), { offset: 140, ms: 1100 });
    await tour.pause(1600);

    // 10. What got through.
    await tour.caption(10);
    await tour.scrollTo(heading(page, "Implausible records in the final dataset"), { offset: 90, ms: 1300 });
    const surcharge = page.getByRole("row", { name: /Total leaves out the congestion surcharge/ });
    await expect(surcharge).toContainText("23,397,653");
    await tour.pause(700);
    await tour.scrollTo(surcharge, { offset: 300, ms: 900 });
    await tour.hover(surcharge, 900);
    await tour.pause(1600);
    await tour.scrollTo(page.getByText("A vendor convention hiding in plain sight", { exact: true }), {
      offset: 260,
      ms: 1100,
    });
    await tour.hover(page.getByText("A vendor convention hiding in plain sight", { exact: true }), 800);
    await tour.pause(2800);

    await finishRecording(context, page, tour);
  });
});

async function desktop(browser: Browser, colorScheme: "light" | "dark" = "light") {
  return browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    colorScheme,
  });
}

async function mobile(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    colorScheme: "light",
  });
}

test.describe("screenshots", () => {
  test("landing, light and dark", async ({ browser }) => {
    for (const scheme of ["light", "dark"] as const) {
      const context = await desktop(browser, scheme);
      const page = await context.newPage();
      await page.goto("/");
      await expect(h1(page)).toContainText("Where, when");
      await settle(page);
      await shot(page, `0${scheme === "light" ? 1 : 2}-landing-${scheme}`);
      await context.close();
    }
  });

  test("key features at 1440 × 900", async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const context = await desktop(browser);
    const ai = await mockAiProviders(context, { latencyMs: 0 });
    const page = await context.newPage();

    // Zone map: median minutes at 3 pm, JFK Airport open.
    await page.goto("/map");
    await mapReady(page, zoneMap.region(page));
    const controls = zoneMap.controls(page);
    await zoneMap.hour(page).fill("15");
    await radio(controls, "Median minutes").click();
    await zoneMap.ranked(page).getByRole("button").filter({ hasText: "JFK Airport" }).click();
    await expect(heading(page, "JFK Airport")).toBeVisible();
    await page.waitForTimeout(2500); // fly to the zone, load its tiles
    await mapReady(page, zoneMap.region(page));
    // Scroll the controls so the weekday, the hour and JFK's 24-hour profile all show.
    await controls.evaluate((el) => {
      const label = Array.from(el.querySelectorAll("label")).find((l) => l.textContent === "Hour of day");
      if (!label) return;
      el.scrollTop += label.getBoundingClientRect().top - el.getBoundingClientRect().top - 110;
    });
    await shot(page, "03-zone-map");

    await page.goto("/routes?zone=132");
    await mapReady(page, page.getByRole("region", { name: /^Busiest taxi routes from JFK Airport/ }));
    await shot(page, "04-routes");

    await page.goto("/conditions");
    await settle(page);
    await shot(page, "05-conditions", { target: heading(page, "A year, day by day"), offset: 80 });

    await page.goto("/estimate?pu=186&do=230");
    await settle(page);
    await expect(estimate.result(page)).toContainText("90% prediction interval: 3.9 to 31.5 min");
    await mapReady(page, page.getByRole("region", { name: /^Map of the chosen pickup/ }));
    await shot(page, "06-estimate", { target: page.locator("form[aria-label='Trip details']"), offset: 88 });

    await page.goto("/evaluation");
    await settle(page);
    await shot(page, "07-evaluation", {
      target: heading(page, "Train on January–October, test on November–December"),
      offset: 80,
    });

    await page.goto("/effects");
    await settle(page);
    await shot(page, "08-effects", { target: heading(page, /^Rain days: about \d+% slower$/), offset: 80 });

    await page.goto("/data-quality");
    await settle(page);
    await shot(page, "09-data-quality", {
      target: heading(page, "Removed in sequence, failing alone, failing only this rule"),
      offset: 80,
    });

    await page.goto("/methods");
    await settle(page);
    await shot(page, "10-methods");

    // Bring your own key: the dialog as a visitor first sees it (no key typed).
    await page.goto("/ask");
    await settle(page);
    await page.getByRole("button", { name: "AI settings (optional, bring your own key)" }).click();
    const dialog = page.getByRole("dialog", { name: "AI settings" });
    await expect(dialog).toBeVisible();
    await expect(radio(dialog, "Anthropic (default)")).toHaveAttribute("aria-checked", "true");
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(SHOT_DIR, "11-ai-settings.png") });

    // A placeholder key, then the example question, answered by the mock.
    await addPlaceholderKey(page, async (t, s) => t.fill(s));
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog.getByText("Anthropic key saved for this tab.")).toBeVisible();
    await dialog.getByRole("button", { name: "Close AI settings" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: TOUR_QUESTION }).click();
    await page.getByRole("button", { name: "Write the SQL" }).click();
    const proposal = page.locator("div[aria-live='polite']").filter({ hasText: "AI-generated" });
    await expect(proposal).toContainText(MOCK_PREFIX);
    await expect(proposal.getByText(`· ${MOCK_MODEL_ID}`)).toBeVisible();
    await expect(proposal.getByRole("textbox")).toHaveValue(MOCK_SQL);
    await page.getByRole("button", { name: "Run this query" }).click();
    await expect(page.getByText("Recorded: accepted as proposed")).toBeVisible();
    const rows = page.getByRole("table", { name: "Query result" });
    await expect(rows.getByRole("row")).toHaveCount(11);
    await expect(rows.getByRole("row").nth(1)).toContainText("Upper East Side South");
    await pinMockLabel(page);
    await shot(page, "12-ask-mocked", { target: heading(page, "Ask in plain English"), offset: 84 });

    await page.goto("/ask/eval");
    await settle(page);
    await shot(page, "13-ask-eval");

    await page.goto("/ai-log");
    await settle(page);
    const entry = page.getByRole("row").filter({ hasText: TOUR_QUESTION });
    await expect(entry).toContainText(MOCK_MODEL_ID);
    await expect(entry).toContainText("Accepted");
    await entry.getByRole("button", { name: "Details" }).click();
    await pinMockLabel(page);
    await shot(page, "14-ai-log");

    await page.goto("/records");
    await settle(page);
    await shot(page, "15-records");

    expect(ai.calls, "one SQL call").toBe(1);
    expect(ai.leaks, "the placeholder key must only go to the (mocked) provider").toEqual([]);
    await context.close();
  });

  test("mobile at 390 × 844", async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const context = await mobile(browser);
    const page = await context.newPage();

    await page.goto("/");
    await settle(page);
    await shot(page, "16-mobile-landing");

    await page.goto("/map");
    await mapReady(page, zoneMap.region(page));
    await shot(page, "17-mobile-map");

    await page.goto("/estimate?pu=186&do=230");
    await settle(page);
    await expect(estimate.result(page)).toContainText("90% prediction interval: 3.9 to 31.5 min");
    await shot(page, "18-mobile-estimate", { target: estimate.result(page), offset: 64 });
    await context.close();
  });
});

test("the tour page lists every walkthrough and serves its videos", async ({ page }) => {
  await page.goto("/tour");
  await expect(h1(page)).toHaveText("The project in three short rides");
  for (const w of WALKTHROUGHS) {
    await expect(heading(page, w.title)).toBeVisible();
    await expect(page.locator(`video[aria-label^="${w.title}:"]`)).toHaveCount(1);
    const media = walkthroughMedia(w.id);
    // Once the media exist (after the first `pnpm showcase`), the site must serve them.
    if (existsSync(path.join(PUBLIC_DIR, media.mp4))) {
      for (const [src, type] of [
        [media.mp4, "video/mp4"],
        [media.poster, "image/webp"],
        [media.captions, "text/vtt"],
      ] as const) {
        const res = await page.request.get(src);
        expect(res.status(), src).toBe(200);
        expect(res.headers()["content-type"], src).toContain(type);
      }
    }
  }
  // The lightbox opens on a thumbnail and closes with Escape.
  await page.getByRole("button", { name: `Enlarge screenshot: ${SCREENSHOTS[2].title}` }).click();
  const lightbox = page.getByRole("dialog", { name: SCREENSHOTS[2].title });
  await expect(lightbox).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: SCREENSHOTS[3].title })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});
