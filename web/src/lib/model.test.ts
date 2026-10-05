import { describe, expect, it } from "vitest";
import rows from "./__fixtures__/model-rows.json";
import artefact from "./data/model.json";
import {
  BLOCKS,
  FEATURE_COUNT,
  blockTotals,
  contributions,
  encode,
  predict,
  type ModelArtefact,
  type TripContext,
} from "./model";

const model = artefact as unknown as ModelArtefact;

function contextOf(r: (typeof rows)[number]): TripContext {
  const [precipitation, snow, snowDepth, tavg, wt01, wt02, wt03, wt06, wt08, events, collisions] = r.numeric;
  return {
    numeric: { precipitation, snow, snowDepth, tavg, wt01, wt02, wt03, wt06, wt08, events, collisions },
    ...r.context,
  };
}

describe("feature layout (cells 268-274)", () => {
  it("has 579 features in VectorAssembler order", () => {
    const total = BLOCKS.reduce((s, b) => s + b.size, 0);
    expect(total).toBe(FEATURE_COUNT);
    for (let i = 1; i < BLOCKS.length; i++)
      expect(BLOCKS[i].start).toBe(BLOCKS[i - 1].start + BLOCKS[i - 1].size);
    expect(model.original.coefficients).toHaveLength(FEATURE_COUNT);
    expect(model.refit.coefficients).toHaveLength(FEATURE_COUNT);
  });

  it("indexes 258 pickup and 259 drop-off zone names like the notebook's OneHotEncoder sizes (cell 270)", () => {
    expect(model.pickupZones).toHaveLength(258);
    expect(model.dropoffZones).toHaveLength(259);
    expect(model.flags).toEqual(["N", "Y"]);
  });
});

describe("parity with the Python encoding of revived model rows", () => {
  it.each(rows.map((r, i) => [i, r] as const))(
    "row %i encodes to the same indices and prediction",
    (_, r) => {
      const f = encode(contextOf(r), model);
      const oneHot = f
        .filter((x) => x.block !== "numeric")
        .map((x) => x.index)
        .sort((a, b) => a - b);
      expect(oneHot).toEqual(r.indices);
      expect(predict(model.original, f)).toBeCloseTo(r.predictOriginal, 9);
      expect(predict(model.refit, f)).toBeCloseTo(r.predictRefit, 9);
    },
  );
});

describe("explanations", () => {
  it("contributions add up to prediction minus intercept", () => {
    const f = encode(contextOf(rows[0]), model);
    const c = contributions(model.original, f);
    const sum = c.reduce((s, x) => s + x.minutes, 0);
    expect(sum).toBeCloseTo(predict(model.original, f) - model.original.intercept, 9);
    const totals = blockTotals(c);
    expect(Object.values(totals).reduce((a, b) => a + b, 0)).toBeCloseTo(sum, 9);
  });

  it("an unknown zone name contributes nothing instead of throwing", () => {
    const ctx = { ...contextOf(rows[0]), pickupZone: "Atlantis" };
    expect(encode(ctx, model).some((x) => x.block === "pickup_zone")).toBe(false);
  });

  it("the 2021 model adds minutes for airport pickups and the JFK flat-rate code", () => {
    const base = contextOf(rows[0]);
    const at = (pickupZone: string, ratecode = 1) =>
      predict(model.original, encode({ ...base, pickupZone, ratecode }, model));
    expect(at("JFK Airport") - at("Midtown Center")).toBeGreaterThan(10);
    expect(at("Midtown Center", 2) - at("Midtown Center", 1)).toBeGreaterThan(20);
  });
});
