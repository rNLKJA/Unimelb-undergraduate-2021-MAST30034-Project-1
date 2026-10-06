import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * The 2021 submission's own per-fold output (coursework/10-folds-linear-regression.csv,
 * written by notebook cell 296). Read straight from the original file so these
 * tests pin the port to the notebook, not to the revived pipeline.
 */
function notebookFolds(): { r2: number; rmse: number; intercept: number; coefficients: number[] }[] {
  const csv = readFileSync(
    path.resolve(import.meta.dirname, "../../../coursework/10-folds-linear-regression.csv"),
    "utf8",
  );
  return csv
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const m = /^\d+,([^,]+),([^,]+),\d+,([^,]+),"\[(.*)\]"$/.exec(line);
      if (!m) throw new Error(`unexpected fold row: ${line.slice(0, 60)}`);
      return {
        r2: Number(m[1]),
        rmse: Number(m[2]),
        intercept: Number(m[3]),
        coefficients: m[4].split(",").map(Number),
      };
    });
}

describe("parity with the 2021 notebook outputs", () => {
  const folds = notebookFolds();

  it("ships fold 1 of the notebook's cross-validation, coefficient for coefficient", () => {
    expect(folds).toHaveLength(10);
    expect(model.original.intercept).toBe(22.351382882356443);
    expect(model.original.intercept).toBe(folds[0].intercept);
    expect(folds[0].coefficients).toHaveLength(FEATURE_COUNT);
    expect(model.original.coefficients).toEqual(folds[0].coefficients);
  });

  it("matches the rounded coefficients printed in cell 296", () => {
    const c = model.original.coefficients;
    expect(c[10]).toBeCloseTo(0.0351, 4); // number_of_collision
    expect(c[44]).toBeCloseTo(-12.0879, 4); // rate code 1
    expect(c[45]).toBeCloseTo(9.2882, 4); // rate code 2 (JFK flat fare)
    expect(c[64]).toBeCloseTo(11.9815, 4);
    expect(c[70]).toBeCloseTo(14.2713, 4);
    // every weather column was shrunk to zero
    expect(c.slice(0, 9).every((v) => v === 0)).toBe(true);
  });

  it("orders zones exactly as the notebook's StringIndexer did (cells 263-270)", () => {
    // cell 263 shows a Borough Park -> Sutton Place/Turtle Bay North trip; cells 267 and
    // 270 index it as pickup 125 of 258 and drop-off 20 of 259
    expect(model.pickupZones[125]).toBe("Borough Park");
    expect(model.dropoffZones[20]).toBe("Sutton Place/Turtle Bay North");
    // so coefficients 64 and 70 (cell 296) are the JFK and LaGuardia pickup zones
    const pickupStart = BLOCKS.find((b) => b.name === "pickup_zone")!.start;
    expect(model.pickupZones[64 - pickupStart]).toBe("JFK Airport");
    expect(model.pickupZones[70 - pickupStart]).toBe("LaGuardia Airport");
  });

  it("predicts the cell 296 airport effects through encode()", () => {
    const base = contextOf(rows[0]);
    const pickupTerm = (pickupZone: string) =>
      contributions(model.original, encode({ ...base, pickupZone }, model)).find(
        (x) => x.block === "pickup_zone",
      )?.minutes ?? 0;
    expect(pickupTerm("JFK Airport")).toBeCloseTo(11.981476367092071, 12);
    expect(pickupTerm("LaGuardia Airport")).toBeCloseTo(14.271335245692162, 12);
  });

  it("reports the notebook's mean R² and RMSE across the 10 folds", () => {
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(artefact.summary.notebook_mean_r2).toBeCloseTo(mean(folds.map((f) => f.r2)), 12);
    expect(artefact.summary.notebook_mean_rmse).toBeCloseTo(mean(folds.map((f) => f.rmse)), 12);
    expect(artefact.summary.notebook_mean_r2).toBeCloseTo(0.3665, 4);
    expect(artefact.summary.notebook_mean_rmse).toBeCloseTo(9.175, 3);
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
