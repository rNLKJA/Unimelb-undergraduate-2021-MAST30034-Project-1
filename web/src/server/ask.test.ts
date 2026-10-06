import { beforeEach, describe, expect, it } from "vitest";
import { compareResults } from "@/lib/ai/sql-eval";
import { POST } from "@/app/api/sql/route";
import { getGoldReferences, getPromptSchema } from "./ask";
import { resetRateLimits, SQL_RATE_LIMIT } from "./rate-limit";
import { runReadOnly } from "./sql-guard";

describe("evaluation questions against analytics.db", () => {
  it("every reference query passes the guard and returns a non-empty result", async () => {
    const refs = await getGoldReferences();
    expect(refs.length).toBeGreaterThanOrEqual(20);
    for (const r of refs) {
      expect(r.result.rows.length, r.id).toBeGreaterThan(0);
      expect(
        r.result.rows.every((row) => row.every((v) => v !== null)),
        r.id,
      ).toBe(true);
      // a reference result always matches itself, strictly
      expect(compareResults(r.result, r.result, r.ordered), r.id).toMatchObject({
        lenient: true,
        strict: true,
      });
    }
  });

  it("rankings have no tie at the cut-off, so the reference answer is unambiguous", async () => {
    const checks: [string, string][] = [
      ["q01", "SELECT pickups FROM zones ORDER BY pickups DESC LIMIT 2"],
      ["q04", "SELECT trips FROM daily ORDER BY trips DESC LIMIT 2"],
      ["q05", "SELECT precipitation FROM weather ORDER BY precipitation DESC LIMIT 6"],
      [
        "q11",
        "SELECT r.trips FROM routes r JOIN zones a ON a.location_id = r.pu_id WHERE a.zone = 'LaGuardia Airport' ORDER BY r.trips DESC LIMIT 2",
      ],
      [
        "q15",
        "SELECT median_min FROM borough_flows WHERE pickup_borough = dropoff_borough ORDER BY median_min DESC LIMIT 2",
      ],
      [
        "q21",
        "SELECT estimate FROM ols_coefficients WHERE block = 'pickup_zone' ORDER BY estimate DESC LIMIT 2",
      ],
      ["q24", "SELECT rows FROM dq_residual_checks ORDER BY rows DESC LIMIT 2"],
    ];
    for (const [id, sql] of checks) {
      const r = await runReadOnly(sql);
      const vals = r.rows.map((row) => row[0]);
      expect(vals[vals.length - 1], id).not.toBe(vals[vals.length - 2]);
    }
  });

  it("describes the schema for the prompt with values for low-cardinality text columns", async () => {
    const schema = await getPromptSchema();
    const names = schema.map((t) => t.name);
    expect(names).toContain("zones");
    expect(names).toContain("ols_coefficients");
    expect(names).not.toContain("meta_tables");
    const flows = schema.find((t) => t.name === "borough_flows")!;
    expect(flows.columns.find((c) => c.name === "pickup_borough")!.values).toContain("Manhattan");
    const routes = schema.find((t) => t.name === "zone_hourly")!;
    expect(routes.columns.find((c) => c.name === "side")!.values).toEqual(["dropoff", "pickup"]);
  });
});

describe("POST /api/sql", () => {
  beforeEach(() => resetRateLimits());
  const post = (body: unknown, ip = "203.0.113.7") =>
    POST(
      new Request("http://localhost/api/sql", {
        method: "POST",
        headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );

  it("runs a valid query", async () => {
    const res = await post({ sql: "SELECT count(*) AS n FROM zones" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ columns: ["n"], rows: [[265]], truncated: false });
  });
  it("rejects writes and malformed bodies with a reason", async () => {
    const write = await post({ sql: "DROP TABLE zones" });
    expect(write.status).toBe(422);
    expect((await write.json()).error).toMatch(/Only SELECT/);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ query: "SELECT 1" })).status).toBe(400);
  });
  it("slows down a client that sends too many queries", async () => {
    for (let i = 0; i < SQL_RATE_LIMIT.tokens; i++) {
      expect((await post({ sql: "SELECT 1 AS one" })).status).toBe(200);
    }
    const limited = await post({ sql: "SELECT 1 AS one" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    // other addresses are unaffected
    expect((await post({ sql: "SELECT 1 AS one" }, "198.51.100.2")).status).toBe(200);
  });
});
