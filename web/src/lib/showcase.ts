/**
 * The guided tour: recorded walkthroughs and key-feature screenshots.
 *
 * One source of truth for the step captions. The Playwright tour
 * (e2e/showcase.spec.ts) shows them as on-screen captions, checks the figures
 * they quote against the live page and writes them to WebVTT files; the /tour
 * page lists them under each video; the README's "Workflow walkthrough"
 * repeats them (src/lib/showcase.test.ts keeps the three in step). Media are
 * produced by `pnpm showcase`.
 */

export type WalkthroughId = "where-and-when" | "estimate-a-trip" | "what-changes-trip-time";

export interface Walkthrough {
  id: WalkthroughId;
  title: string;
  /** Routes the walkthrough visits, in order. */
  routes: readonly string[];
  summary: string;
  /** Inputs and seeds, so the recording can be reproduced by hand. */
  setup: string;
  /** On-screen captions, in order (step k is shown as "k/N"). */
  steps: readonly string[];
  /** Step numbers (1-based) whose caption shows the "mocked AI response" badge. */
  mockedSteps?: readonly number[];
}

export const MOCK_LABEL = "Mocked AI response for illustration";

/** Opens every mocked model reply, so the text itself says what it is. */
export const MOCK_PREFIX = "Mocked response for illustration.";

/** The model name the mock reports, shown next to the "AI-generated" label and in the audit log. */
export const MOCK_MODEL_ID = "mock-for-illustration";

/** The example question the AI screenshots ask (one of the example chips on /ask). */
export const TOUR_QUESTION = "Which ten routes between different zones had the most trips?";

export const WALKTHROUGHS: readonly Walkthrough[] = [
  {
    id: "where-and-when",
    title: "Where and when",
    routes: ["/map", "/routes"],
    summary:
      "The zone choropleth of 74.9 million cleaned 2019 trips: scrub the hour, switch the weekday, recolour by median minutes, open JFK Airport's detail and its 24-hour profile, play the day, then follow JFK's busiest routes.",
    setup:
      "Pickups, starting from the map's defaults (all days, 6 pm). No sampling and no randomness: every figure is a full count over the cleaned 2019 trips.",
    steps: [
      "The zone map: 74.9 million cleaned 2019 trips by taxi zone, here pickups from 6 to 7 pm",
      "Scrub the hour: 4 am is the quietest, 558,493 pickups in 2019 against 4.9 million at 6 pm",
      "8 am: the morning peak starts on the Upper East Side",
      "Saturday, 1 am: the East Village and the Lower East Side lead the night",
      "All days at 3 pm, coloured by median minutes: the airports and the outer zones are slowest",
      "Open JFK Airport: its pickups, median trip, 24-hour profile and vendor split",
      "A JFK pickup takes a median 26.2 min at 1 am and 51.8 min at 3 pm",
      "Play the day: the hour advances and the whole map follows",
      "Routes from JFK Airport: the busiest destinations, drawn like subway lines",
    ],
  },
  {
    id: "estimate-a-trip",
    title: "Estimate a trip",
    routes: ["/estimate", "/evaluation"],
    summary:
      "The 2021 regression running in the browser: pick a pickup and a drop-off zone, a date and an hour, read the prediction with its split-conformal interval next to what riders actually saw, change the interval level and the hour, see every term of the sum, then check how the intervals were validated.",
    setup:
      "Penn Station/Madison Sq West to Times Sq/Theatre District, Wednesday 9 October 2019, 1 passenger, vendor 2, rate code 1. The intervals are fixed quantiles from the calibration fold; their coverage intervals resample whole test days (B = 2,000, seed 20190101).",
    steps: [
      "Estimate a trip: the 2021 regression runs in your browser, all 579 features of it",
      "Pick a pickup zone: Penn Station/Madison Sq West",
      "And a drop-off: Times Sq/Theatre District, on Wednesday 9 October 2019 at 5 pm",
      "The 2021 model predicts 14.2 min, with a 90% split-conformal interval of 3.9 to 31.5 min",
      "Riders saw a median of 13.3 min at 5 pm, over 9,856 trips: the dashed blue line",
      "At 95% the interval widens to 3.1 to 36.7 min, and 95.0% of held-out trips like these fell inside",
      "Change the hour to 8 am: 13.2 min, and the interval moves with the prediction",
      "Why that number: a linear model is a sum, and each bar is one part of the trip",
      "How the intervals were checked: coverage on 7.5 million held-out trips, with day-bootstrap CIs",
    ],
  },
  {
    id: "what-changes-trip-time",
    title: "What changes trip time",
    routes: ["/effects", "/data-quality"],
    summary:
      "Does rain or a street event slow a taxi down? A composition-adjusted duration index, the rain regression with bootstrap, HC3 and Newey–West intervals, a matched comparison for permitted events, the caveats, then the data-quality report behind the cleaned data.",
    setup:
      "Bootstrap intervals resample days (rain) or dates (events), B = 4,000, seed 20190101. Wet means at least 0.1 inch at Central Park. Data-quality figures are full counts over the 2019 records, not samples.",
    steps: [
      "What changes trip time? Each trip is compared with its own route and hour",
      "One dot per day: how much longer than usual the day's trips took, against Central Park rain",
      "Rain: the same trips are 3.4% slower on wet days (95% CI 1.9% to 4.8%), over 333 days",
      "Every comparison with its interval: two-sample, regression and rain bins",
      "Permitted events: 31 matched pairs on 16 dates, −0.6% (95% CI −2.8% to +1.8%), no detectable effect",
      "The caveats: observational data, one rain gauge, collisions as a mediator",
      "The data-quality report: what each 2021 cleaning rule removes, and why",
      "Missing values: until 21 January 2019 almost every row lacks the congestion surcharge",
      "Rule by rule: removed in sequence, failing alone and failing only this rule",
      "What got through: vendor 1 leaves the $2.50 surcharge out of the total on 23.4 million trips",
    ],
  },
];

export interface Screenshot {
  /** File name without extension, e.g. "01-landing-light". */
  id: string;
  title: string;
  caption: string;
  viewport: "desktop" | "mobile";
}

export const SCREENSHOTS: readonly Screenshot[] = [
  {
    id: "01-landing-light",
    title: "Landing page",
    caption: "The question, the key numbers and a map of 2019 pickups by taxi zone.",
    viewport: "desktop",
  },
  {
    id: "02-landing-dark",
    title: "Landing page, dark mode",
    caption: "The same page in the asphalt dark theme.",
    viewport: "desktop",
  },
  {
    id: "03-zone-map",
    title: "Zone map",
    caption: "Median minutes by pickup zone at 3 pm, with JFK Airport's 24-hour profile.",
    viewport: "desktop",
  },
  {
    id: "04-routes",
    title: "Route explorer",
    caption: "JFK Airport's busiest destinations, drawn like subway lines.",
    viewport: "desktop",
  },
  {
    id: "05-conditions",
    title: "Weather, events, collisions",
    caption: "Every day of 2019 next to the extra data the 2021 model used.",
    viewport: "desktop",
  },
  {
    id: "06-estimate",
    title: "Estimate a trip",
    caption: "The 2021 regression in the browser, with a split-conformal prediction interval.",
    viewport: "desktop",
  },
  {
    id: "07-evaluation",
    title: "Evaluation",
    caption: "A temporal hold-out with day-bootstrap intervals: a lookup table beats the regression.",
    viewport: "desktop",
  },
  {
    id: "08-effects",
    title: "Rain and events",
    caption: "Wet days are 3.4% slower (95% CI 1.9% to 4.8%), with every comparison's interval.",
    viewport: "desktop",
  },
  {
    id: "09-data-quality",
    title: "Data quality",
    caption: "Each cleaning rule: removed in sequence, failing alone and failing only that rule.",
    viewport: "desktop",
  },
  {
    id: "10-methods",
    title: "Methods and decisions",
    caption: "Data provenance, evaluation design, decision records, the model card and the AI use statement.",
    viewport: "desktop",
  },
  {
    id: "11-ai-settings",
    title: "Bring your own key",
    caption: "Optional AI settings: Anthropic by default, the key stays in this browser.",
    viewport: "desktop",
  },
  {
    id: "12-ask-mocked",
    title: "Ask the data (mocked reply)",
    caption: "Proposed SQL labelled AI-generated, run only after a human accepts it. The reply is mocked.",
    viewport: "desktop",
  },
  {
    id: "13-ask-eval",
    title: "Text-to-SQL evaluation",
    caption: "24 questions with reference answers, Wilson intervals and an exact McNemar test.",
    viewport: "desktop",
  },
  {
    id: "14-ai-log",
    title: "AI audit log",
    caption: "Every AI call from this browser with the human decision; JSON and CSV export.",
    viewport: "desktop",
  },
  {
    id: "15-records",
    title: "Records",
    caption: "Every table of the read-only analytics database, searchable and downloadable.",
    viewport: "desktop",
  },
  {
    id: "16-mobile-landing",
    title: "Mobile: landing",
    caption: "The landing page on a 390 px phone.",
    viewport: "mobile",
  },
  {
    id: "17-mobile-map",
    title: "Mobile: zone map",
    caption: "The zone map and its controls on a phone.",
    viewport: "mobile",
  },
  {
    id: "18-mobile-estimate",
    title: "Mobile: estimate",
    caption: "A prediction and its interval on a phone.",
    viewport: "mobile",
  },
];

/** Public paths of a walkthrough's media (files live in web/public/showcase/). */
export function walkthroughMedia(id: WalkthroughId) {
  return {
    mp4: `/showcase/${id}.mp4`,
    poster: `/showcase/${id}-poster.webp`,
    captions: `/showcase/${id}.vtt`,
  };
}

/** Public path of a screenshot's full-size WebP copy used by the /tour lightbox. */
export const screenshotSrc = (id: string) => `/showcase/screens/${id}.webp`;

/** Public path of a screenshot's thumbnail used by the /tour grid. */
export const thumbnailSrc = (id: string) => `/showcase/screens/${id}-thumb.webp`;

/** Pixel sizes of the WebP copies (desktop 1440 × 900; mobile 390 × 844 at 1.5×) and thumbnails. */
export const SCREENSHOT_SIZE = {
  desktop: { width: 1440, height: 900, thumbWidth: 720, thumbHeight: 450 },
  mobile: { width: 585, height: 1266, thumbWidth: 390, thumbHeight: 844 },
} as const;
