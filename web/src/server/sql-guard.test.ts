import { describe, expect, it } from "vitest";
import {
  checkPlan,
  COST_LIMIT,
  estimateCost,
  estimateCostFromPlan,
  MAX_CELL_CHARS,
  MAX_ROWS,
  QueryRejected,
  runReadOnly,
  searchedColumns,
  searchEqualityColumns,
  stripLiteralsAndComments,
  tableAliases,
  userConnection,
  validateSql,
} from "./sql-guard";
import { resetRateLimits, takeToken } from "./rate-limit";

/** n nested replace() calls, each making the string `factor` times longer */
function nestedReplace(levels: number, factor = 2): string {
  const rep = "a".repeat(factor);
  let expr = `'${rep}'`;
  for (let i = 0; i < levels; i++) expr = `replace(${expr}, 'a', '${rep}')`;
  return expr;
}

describe("validateSql", () => {
  it("accepts single SELECT and WITH queries and drops a trailing semicolon", () => {
    expect(validateSql("SELECT * FROM zones;")).toEqual({ ok: true, sql: "SELECT * FROM zones" });
    expect(validateSql("  with t as (select 1 as x) select x from t ").ok).toBe(true);
    expect(validateSql("SELECT replace(zone, 'a', 'b') FROM zones").ok).toBe(true);
    expect(validateSql('SELECT "zone", count(*) FROM "zones" GROUP BY "zone"').ok).toBe(true);
  });
  it("ignores keywords inside strings and comments", () => {
    expect(validateSql("SELECT 'drop table zones; --' AS note").ok).toBe(true);
    expect(validateSql("SELECT 1 -- delete everything\n").ok).toBe(true);
    expect(validateSql("SELECT '\"printf\"(1)' AS note").ok).toBe(true);
    expect(stripLiteralsAndComments("SELECT 'it''s' /* x */ AS a")).toBe("SELECT ''   AS a");
  });
  it.each([
    ["", /empty/],
    ["DELETE FROM zones", /Only SELECT/],
    ["SELECT 1; DROP TABLE zones", /one statement/],
    ["SELECT * FROM zones WHERE 1 = 1; ", undefined],
    ["WITH x AS (SELECT 1) INSERT INTO zones SELECT * FROM x", /INSERT/],
    ["SELECT * FROM pragma_table_info('zones')", undefined],
    ["SELECT 1 FROM zones UNION SELECT 2; ATTACH 'x' AS y", /one statement/],
    ["WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c", /RECURSIVE/],
    ["SELECT load_extension('/tmp/evil')", /load_extension/],
    ["SELECT zeroblob(1000000000)", /zeroblob/],
    ["SELECT printf('%.*c', 1000000000, 'x')", /printf/],
    // quoted and bracketed names call the same function
    [`SELECT length("printf"('%.*c', 200000000, 'x'))`, /Quoted names/],
    ["SELECT [printf]('%.*c', 200000000, 'x')", /Quoted names/],
    ["SELECT `zeroblob` (1000000000)", /Quoted names/],
    ["SELECT count(*) FROM generate_series(1, 500000000)", /generate_series/],
    ["SELECT * FROM zones; PRAGMA writable_schema = 1", /one statement/],
    ["REPLACE INTO zones VALUES (1)", /Only SELECT/],
    ["SELECT 1 WHERE 1 REPLACE", /REPLACE/],
    ["SELECT " + "x, ".repeat(2000) + "1", /limited/],
  ])("rejects %s", (sql, message) => {
    const v = validateSql(sql);
    if (message === undefined) {
      expect(v.ok).toBe(true);
    } else {
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.error).toMatch(message);
    }
  });
});

describe("checkPlan", () => {
  it("refuses recursive steps and unapproved table-valued functions", () => {
    const recursive = [
      { id: 2, parent: 0, detail: "CO-ROUTINE c" },
      { id: 5, parent: 2, detail: "SETUP" },
      { id: 17, parent: 2, detail: "RECURSIVE STEP" },
      { id: 18, parent: 17, detail: "SCAN c" },
    ];
    expect(checkPlan(recursive)).toMatch(/Recursive/);
    expect(checkPlan([{ id: 3, parent: 0, detail: "SCAN generate_series VIRTUAL TABLE INDEX 3:" }])).toMatch(
      /generate_series/,
    );
    expect(checkPlan([{ id: 2, parent: 0, detail: "SCAN json_each VIRTUAL TABLE INDEX 1:" }])).toBeNull();
    expect(
      checkPlan([{ id: 2, parent: 0, detail: "SCAN pragma_table_info VIRTUAL TABLE INDEX 0:" }]),
    ).toBeNull();
  });
});

describe("estimateCostFromPlan", () => {
  const rows = { a: 1000, b: 2000, zones: 265 };
  it("multiplies nested loops and adds independent steps", () => {
    const nested = [
      { id: 2, parent: 0, detail: "SCAN a" },
      { id: 3, parent: 0, detail: "SCAN b" },
    ];
    expect(estimateCostFromPlan(nested, rows)).toBe(1000 + 1000 * 2000);
    const lookup = [
      { id: 2, parent: 0, detail: "SCAN a" },
      { id: 3, parent: 0, detail: "SEARCH zones USING INTEGER PRIMARY KEY (rowid=?)" },
    ];
    expect(estimateCostFromPlan(lookup, rows)).toBe(2000);
    const union = [
      { id: 1, parent: 0, detail: "COMPOUND QUERY" },
      { id: 2, parent: 1, detail: "LEFT-MOST SUBQUERY" },
      { id: 3, parent: 2, detail: "SCAN a" },
      { id: 4, parent: 1, detail: "UNION ALL" },
      { id: 5, parent: 4, detail: "SCAN b" },
    ];
    expect(estimateCostFromPlan(union, rows)).toBe(3000);
  });
  it("bounds each lookup into a stored table by the most frequent value of the searched columns", () => {
    expect(searchEqualityColumns("SEARCH b USING AUTOMATIC COVERING INDEX (side=?)")).toEqual(["side"]);
    expect(searchEqualityColumns("SEARCH t USING INDEX i (ANY(a) AND b=? AND c>?)")).toEqual(["b"]);
    expect(searchEqualityColumns("SEARCH t USING INTEGER PRIMARY KEY (rowid>?)")).toEqual([]);
    const plan = [
      { id: 2, parent: 0, detail: "SCAN x" },
      { id: 3, parent: 0, detail: "SEARCH y USING INDEX b_kv (k=? AND v=?)" },
    ];
    expect(searchedColumns(plan, rows, { x: "a", y: "b" })).toEqual([
      { table: "b", column: "k" },
      { table: "b", column: "v" },
    ]);
    // the tighter of the two columns bounds the lookup
    expect(estimateCostFromPlan(plan, rows, { x: "a", y: "b" }, { "b.k": 1000, "b.v": 40 })).toBe(
      1000 + 1000 * 40,
    );
    // a low-cardinality key: every lookup may return half the table
    const lowCard = [
      { id: 4, parent: 0, detail: "SCAN a" },
      { id: 6, parent: 0, detail: "SEARCH b USING AUTOMATIC COVERING INDEX (side=?)" },
    ];
    expect(estimateCostFromPlan(lowCard, rows, {}, { "b.side": 1000 })).toBe(1000 + 1000 * 1000);
    // range-only searches and rowid ranges may read the whole table
    const range = [
      { id: 2, parent: 0, detail: "SCAN a" },
      { id: 3, parent: 0, detail: "SEARCH b USING INTEGER PRIMARY KEY (rowid>?)" },
    ];
    expect(estimateCostFromPlan(range, rows)).toBe(1000 + 1000 * 2000);
  });
  it("resolves table aliases, which plans report instead of table names", () => {
    expect(
      tableAliases("SELECT * FROM a x JOIN b AS y ON y.k = x.k, zones z WHERE 1", ["a", "b", "zones"]),
    ).toEqual({
      x: "a",
      y: "b",
      z: "zones",
    });
    expect(tableAliases("SELECT * FROM a WHERE 1", ["a"])).toEqual({});
  });
  it("uses a sqrt(n) heuristic for lookups into CTEs, which have no statistics", () => {
    const plan = [
      { id: 3, parent: 0, detail: "MATERIALIZE c" },
      { id: 4, parent: 3, detail: "SCAN a" },
      { id: 5, parent: 0, detail: "SCAN x" },
      { id: 6, parent: 0, detail: "SEARCH c USING AUTOMATIC COVERING INDEX (k=?)" },
    ];
    // MATERIALIZE c costs 1000; outer SCAN x (unknown) uses the fallback of 10,000 rows
    expect(estimateCostFromPlan(plan, rows)).toBe(1000 + 10_000 + 10_000 * 32);
  });
  it("charges correlated subqueries once per outer row", () => {
    const plan = [
      { id: 2, parent: 0, detail: "SCAN a" },
      { id: 3, parent: 0, detail: "CORRELATED SCALAR SUBQUERY 1" },
      { id: 4, parent: 3, detail: "SCAN b" },
    ];
    expect(estimateCostFromPlan(plan, rows)).toBe(1000 + 1000 * 2000);
  });
});

describe("read-only execution on analytics.db", () => {
  it("runs a simple query and reports what it did", async () => {
    const r = await runReadOnly("SELECT zone, pickups FROM zones ORDER BY pickups DESC LIMIT 3");
    expect(r.columns).toEqual(["zone", "pickups"]);
    expect(r.rows).toHaveLength(3);
    expect(r.truncated).toBe(false);
    expect(r.shortenedCells).toBe(0);
    expect(r.estimatedRows).toBeGreaterThan(0);
  });
  it("keeps the query's order and caps the rows returned", async () => {
    const ordered = await runReadOnly("SELECT location_id, pickups FROM zones ORDER BY pickups DESC");
    const values = ordered.rows.map((r) => Number(r[1]));
    expect(values).toEqual([...values].sort((a, b) => b - a));
    const r = await runReadOnly("SELECT * FROM routes");
    expect(r.rows).toHaveLength(MAX_ROWS);
    expect(r.truncated).toBe(true);
  });
  it("allows key joins and refuses cartesian products and runaway correlated subqueries", async () => {
    const join = await estimateCost(
      "SELECT z.zone, r.trips FROM routes r JOIN zones z ON z.location_id = r.pu_id ORDER BY r.trips DESC LIMIT 5",
    );
    expect(join.rows).toBeLessThan(COST_LIMIT);
    await expect(runReadOnly("SELECT count(*) FROM routes a, route_hourly b")).rejects.toThrow(
      /visit roughly/,
    );
    await expect(
      runReadOnly(
        "SELECT pu_id, (SELECT count(*) FROM route_hourly h WHERE h.trips > r.trips) FROM routes r",
      ),
    ).rejects.toThrow(QueryRejected);
  });
  it("refuses joins on low-cardinality columns, which visit billions of rows", async () => {
    // zone_hourly.side has two values: 98,357 x ~49,000 lookups
    await expect(
      runReadOnly("SELECT count(*) FROM zone_hourly a JOIN zone_hourly b ON a.side = b.side"),
    ).rejects.toThrow(/visit roughly/);
    // hour has 24 values: an automatic index on b.hour returns thousands of rows per lookup
    await expect(
      runReadOnly("SELECT count(*) FROM route_hourly a JOIN zone_hourly b ON a.hour = b.hour"),
    ).rejects.toThrow(/visit roughly/);
  });
  it("refuses recursive CTEs written without the RECURSIVE keyword", async () => {
    await expect(
      runReadOnly(
        "WITH c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 10000000) SELECT max(x) FROM c",
      ),
    ).rejects.toThrow(/Recursive/);
  });
  it("stops queries that build huge values (SQLite heap limit)", async () => {
    // 26 doublings: 128 MB of text
    await expect(runReadOnly(`SELECT length(${nestedReplace(26)}) AS n`)).rejects.toThrow(
      /larger than the server allows/,
    );
    // 12 quadruplings: 67 MB
    await expect(runReadOnly(`SELECT ${nestedReplace(12, 4)} AS s`)).rejects.toThrow(
      /larger than the server allows/,
    );
    // the connection still works afterwards
    expect((await runReadOnly("SELECT count(*) AS n FROM zones")).rows).toEqual([[265]]);
  });
  it("shortens long text cells and refuses oversized results", async () => {
    const r = await runReadOnly(`SELECT ${nestedReplace(14)} AS s`); // 32,768 characters
    expect(r.shortenedCells).toBe(1);
    expect(String(r.rows[0][0]).length).toBeLessThan(MAX_CELL_CHARS + 20);
    // 265 rows x 4,096 characters is over 1 MB
    await expect(runReadOnly(`SELECT location_id, ${nestedReplace(5, 4)} AS s FROM zones`)).rejects.toThrow(
      /larger than 1 MB/,
    );
  });
  it("interrupts a query that runs past the time limit without blocking the event loop", async () => {
    // a self-join through a CTE: the cost estimate uses a heuristic for CTE lookups and lets it
    // through, so the time limit has to stop it
    const slow =
      "WITH a AS MATERIALIZED (SELECT hour FROM route_hourly) SELECT count(*) FROM a x JOIN a y ON x.hour = y.hour";
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    const t0 = performance.now();
    await expect(runReadOnly(slow, { timeoutMs: 300 })).rejects.toThrow(/was stopped/);
    clearInterval(timer);
    expect(performance.now() - t0).toBeLessThan(2500);
    expect(ticks).toBeGreaterThan(3);
    expect((await runReadOnly("SELECT 1 AS one")).rows).toEqual([[1]]);
  });
  it("runs one query at a time and turns work away when too many are waiting", async () => {
    const slow =
      "WITH a AS MATERIALIZED (SELECT hour FROM route_hourly) SELECT count(*) FROM a x JOIN a y ON x.hour = y.hour";
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => runReadOnly(slow, { timeoutMs: 100 })),
    );
    const statuses = results.map((r) =>
      r.status === "rejected" && r.reason instanceof QueryRejected ? r.reason.status : 0,
    );
    expect(statuses.filter((s) => s === 503)).toHaveLength(1);
    expect(statuses.filter((s) => s === 422)).toHaveLength(4);
  });
  it("reports SQLite errors as rejections without the raw error code", async () => {
    await expect(runReadOnly("SELECT nope FROM zones")).rejects.toThrow(/no such column/);
    await expect(runReadOnly("SELECT * FROM no_such_table")).rejects.toThrow(
      /^SQLite could not plan this query: no such table/,
    );
  });
  it("cannot write even if validation were bypassed (PRAGMA query_only)", async () => {
    const c = await userConnection();
    await expect(c.exec("CREATE TABLE should_not_exist (x INTEGER)")).rejects.toThrow();
    const r = await runReadOnly("SELECT count(*) AS n FROM sqlite_master WHERE name = 'should_not_exist'");
    expect(r.rows).toEqual([[0]]);
  });
});

describe("rate limit", () => {
  it("allows a burst, then asks the client to wait, then refills", () => {
    resetRateLimits();
    const t = 1_000_000;
    for (let i = 0; i < 3; i++) expect(takeToken("ip", 3, 60_000, t)).toBe(0);
    expect(takeToken("ip", 3, 60_000, t)).toBe(20_000);
    expect(takeToken("other", 3, 60_000, t)).toBe(0);
    expect(takeToken("ip", 3, 60_000, t + 20_000)).toBe(0);
    resetRateLimits();
  });
});
