import { describe, expect, it } from "vitest";
import { getTable, queryTable, tableParamsSchema } from "./records";

describe("records browser", () => {
  it("lists busiest routes first when no column is chosen", async () => {
    const t = (await getTable("routes"))!;
    const { rows } = await queryTable(t, tableParamsSchema.parse({}));
    const trips = rows.map((r) => Number(r.trips));
    expect(trips).toEqual([...trips].sort((a, b) => b - a));
  });

  it("honours an explicit sort and ignores unknown columns", async () => {
    const t = (await getTable("zones"))!;
    const asc = await queryTable(t, tableParamsSchema.parse({ sort: "zone" }));
    const names = asc.rows.map((r) => String(r.zone));
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    const bogus = await queryTable(t, tableParamsSchema.parse({ sort: "nope" }));
    expect(bogus.rows[0].location_id).toBe(1);
  });

  it("escapes LIKE wildcards in search", async () => {
    const t = (await getTable("zones"))!;
    const { total } = await queryTable(t, tableParamsSchema.parse({ q: "%" }));
    expect(total).toBe(0);
  });
});
