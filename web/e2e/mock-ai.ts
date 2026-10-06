/**
 * A mocked AI provider for the tour's "Ask the data" screenshots. No real key
 * is ever used: the "key" is a placeholder typed into the bring-your-own-key
 * dialog, every request to a provider is intercepted in the browser context,
 * and the reply is written here.
 *
 * The mocked reply to the example question is a real, guarded query (it runs
 * on the site's read-only database once a person accepts it), its explanation
 * starts with MOCK_PREFIX and the model it reports is MOCK_MODEL_ID, so
 * nothing in a screenshot can be mistaken for a real model's output. It
 * reports no token usage: the mock has none to report.
 */
import type { BrowserContext, Request } from "@playwright/test";

import { MOCK_MODEL_ID, MOCK_PREFIX, TOUR_QUESTION } from "../src/lib/showcase";

/** Not a credential: an obviously fake placeholder typed into the BYOK dialog. */
export const PLACEHOLDER_KEY = "placeholder-not-a-real-key";

/** The query the mock proposes for TOUR_QUESTION. */
export const MOCK_SQL = `SELECT pz.zone AS pickup_zone, dz.zone AS dropoff_zone, r.trips
FROM routes r
JOIN zones pz ON pz.location_id = r.pu_id
JOIN zones dz ON dz.location_id = r.do_id
WHERE r.pu_id <> r.do_id
ORDER BY r.trips DESC
LIMIT 10`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "POST, OPTIONS",
};

/** The structured reply (the SqlAnswer contract) the mock gives for a user message. */
export function mockSqlAnswer(user: string) {
  if (user.includes(TOUR_QUESTION)) {
    return {
      answerable: true,
      sql: MOCK_SQL,
      explanation: `${MOCK_PREFIX} Joins routes to zones twice to name both ends, keeps routes whose pickup and drop-off zones differ, and ranks them by 2019 trips.`,
      tables_used: ["routes", "zones"],
      assumptions: [
        `${MOCK_PREFIX} "Between different zones" is read as the pickup zone not being the drop-off zone.`,
      ],
    };
  }
  return {
    answerable: false,
    sql: "",
    explanation: `${MOCK_PREFIX} The mock only answers the tour's example question.`,
    tables_used: [],
    assumptions: [],
  };
}

export interface MockAi {
  /** Requests that reached the mock (each one an AI call the app made). */
  calls: number;
  /** Requests to anything else that carried the placeholder key (must stay empty). */
  leaks: string[];
}

export async function mockAiProviders(
  context: BrowserContext,
  { latencyMs = 900 }: { latencyMs?: number } = {},
): Promise<MockAi> {
  const state: MockAi = { calls: 0, leaks: [] };

  await context.route("https://api.anthropic.com/**", async (route) => {
    const req = route.request();
    if (req.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS });
      return;
    }
    state.calls += 1;
    const body = JSON.parse(req.postData() ?? "{}") as {
      messages?: { role: string; content: string }[];
    };
    const user = body.messages?.find((m) => m.role === "user")?.content ?? "";
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    await route.fulfill({
      status: 200,
      headers: { ...CORS, "content-type": "application/json" },
      body: JSON.stringify({
        id: `msg_mock_${state.calls}`,
        type: "message",
        role: "assistant",
        model: MOCK_MODEL_ID,
        content: [{ type: "text", text: JSON.stringify(mockSqlAnswer(String(user))) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        // No usage block: the mock has no token counts to report.
      }),
    });
  });

  // The tour never uses OpenAI; block it so nothing can leave the browser.
  await context.route("https://api.openai.com/**", (route) => route.abort("blockedbyclient"));

  context.on("request", (req: Request) => {
    if (req.url().startsWith("https://api.anthropic.com/")) return;
    const headers = JSON.stringify(req.headers());
    const data = req.postData() ?? "";
    if (
      headers.includes(PLACEHOLDER_KEY) ||
      data.includes(PLACEHOLDER_KEY) ||
      req.url().includes(PLACEHOLDER_KEY)
    ) {
      state.leaks.push(req.url());
    }
  });

  return state;
}
