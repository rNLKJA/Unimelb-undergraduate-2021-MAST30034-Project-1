import { describe, expect, it } from "vitest";
import {
  COST_LIMIT,
  estimateCost,
  estimateCostFromPlan,
  MAX_ROWS,
  QueryRejected,
  runReadOnly,
  stripLiteralsAndComments,
  tableAliases,
  userClient,
  validateSql,
} from "./sql-guard";

describe("validateSql", () => {
  it("accepts single SELECT and WITH queries and drops a trailing semicolon", () => {
    expect(validateSql("SELECT * FROM zones;")).toEqual({ ok: true, sql: "SELECT * FROM zones" });
    expect(validateSql("  with t as (select 1 as x) select x from t ").ok).toBe(true);
    expect(validateSql("SELECT replace(zone, 'a', 'b') FROM zones").ok).toBe(true);
  });
  it("ignores keywords inside strings and comments", () => {
    expect(validateSql("SELECT 'drop table zones; --' AS note").ok).toBe(true);
    expect(validateSql("SELECT 1 -- delete everything\n").ok).toBe(true);
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
  it("resolves table aliases, which plans report instead of table names", () => {
    expect(
      tableAliases("SELECT * FROM a x JOIN b AS y ON y.k = x.k, zones z WHERE 1", ["a", "b", "zones"]),
    ).toEqual({
      x: "a",
      y: "b",
      z: "zones",
    });
    expect(tableAliases("SELECT * FROM a WHERE 1", ["a"])).toEqual({});
    const plan = [
      { id: 2, parent: 0, detail: "SCAN x" },
      { id: 3, parent: 0, detail: "SEARCH y USING INDEX b_k (k=?)" },
    ];
    expect(estimateCostFromPlan(plan, rows, { x: "a", y: "b" })).toBe(1000 + 1000 * 45);
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
    expect(r.estimatedRows).toBeGreaterThan(0);
  });
  it("caps the rows returned", async () => {
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
  it("reports SQLite errors as rejections", async () => {
    await expect(runReadOnly("SELECT nope FROM zones")).rejects.toThrow(/no such column/);
    await expect(runReadOnly("SELECT * FROM no_such_table")).rejects.toThrow(QueryRejected);
  });
  it("cannot write even if validation were bypassed (PRAGMA query_only)", async () => {
    const c = await userClient();
    await expect(c.execute("CREATE TABLE should_not_exist (x INTEGER)")).rejects.toThrow();
    const t = await c.execute("SELECT count(*) AS n FROM sqlite_master WHERE name = 'should_not_exist'");
    expect(Number(t.rows[0].n)).toBe(0);
  });
});
