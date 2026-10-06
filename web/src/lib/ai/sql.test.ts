import { describe, expect, it } from "vitest";
import {
  buildSqlRequest,
  describeSchema,
  SQL_ANSWER_JSON_SCHEMA,
  SqlAnswerSchema,
  type SchemaTable,
} from "./sql-assistant";
import {
  compareResults,
  compareRuns,
  estimateCostUsd,
  GOLD_QUESTIONS,
  summariseRun,
  type EvalItemResult,
} from "./sql-eval";

const tables: SchemaTable[] = [
  {
    name: "zones",
    title: "Taxi zones",
    description: "One row per zone.",
    rows: 265,
    columns: [
      { name: "location_id", type: "INTEGER" },
      { name: "borough", type: "TEXT", values: ["Bronx", "Queens"] },
    ],
  },
];

describe("prompt", () => {
  it("describes the schema fully or barely", () => {
    expect(describeSchema(tables, "bare")).toBe("zones(location_id, borough)");
    const full = describeSchema(tables, "described");
    expect(full).toContain("zones: Taxi zones, 265 rows. One row per zone.");
    expect(full).toContain("borough TEXT (values: 'Bronx', 'Queens')");
  });
  it("builds a structured request with domain notes only in the described variant", () => {
    const d = buildSqlRequest("  How many zones?  ", tables, "described");
    expect(d.user).toBe("Question: How many zones?");
    expect(d.system).toContain("Domain notes");
    expect(d.system).toContain("SELECT");
    expect(buildSqlRequest("q", tables, "bare").system).not.toContain("Domain notes");
    expect(d.jsonSchema).toBe(SQL_ANSWER_JSON_SCHEMA);
  });
  it("keeps the JSON Schema and the zod schema in step", () => {
    const sample = {
      answerable: true,
      sql: "SELECT 1",
      explanation: "e",
      tables_used: ["zones"],
      assumptions: [],
    };
    expect(SqlAnswerSchema.safeParse(sample).success).toBe(true);
    expect(Object.keys(SQL_ANSWER_JSON_SCHEMA.properties).sort()).toEqual(Object.keys(sample).sort());
    expect([...SQL_ANSWER_JSON_SCHEMA.required].sort()).toEqual(Object.keys(sample).sort());
    expect(SqlAnswerSchema.safeParse({ ...sample, sql: "  " }).success).toBe(false);
    expect(SqlAnswerSchema.safeParse({ ...sample, answerable: false, sql: "" }).success).toBe(true);
  });
});

describe("execution-accuracy comparison", () => {
  const ref = { columns: ["zone"], rows: [["JFK Airport"]] };
  it("ignores aliases and allows extra columns (lenient) but not for strict", () => {
    expect(compareResults(ref, { columns: ["z"], rows: [["JFK Airport"]] }, false)).toMatchObject({
      lenient: true,
      strict: true,
    });
    expect(
      compareResults(ref, { columns: ["zone", "trips"], rows: [["JFK Airport", 123]] }, false),
    ).toMatchObject({ lenient: true, strict: false });
    expect(compareResults(ref, { columns: ["zone"], rows: [["LaGuardia Airport"]] }, false).lenient).toBe(
      false,
    );
    expect(compareResults(ref, { columns: ["zone"], rows: [] }, false).reason).toMatch(/0 row/);
  });
  it("compares numbers to 6 significant digits and integers exactly", () => {
    const r = { columns: ["x"], rows: [[0.123456789]] };
    expect(compareResults(r, { columns: ["x"], rows: [[0.1234567]] }, false).lenient).toBe(true);
    expect(compareResults(r, { columns: ["x"], rows: [[0.1235]] }, false).lenient).toBe(false);
    expect(
      compareResults({ columns: ["n"], rows: [[5]] }, { columns: ["n"], rows: [[5.0]] }, false).lenient,
    ).toBe(true);
  });
  it("respects row order only when the question asks for a ranking", () => {
    const e = {
      columns: ["d", "p"],
      rows: [
        ["a", 2],
        ["b", 1],
      ],
    };
    const swapped = {
      columns: ["p", "d"],
      rows: [
        [1, "b"],
        [2, "a"],
      ],
    };
    expect(compareResults(e, swapped, false).lenient).toBe(true);
    expect(compareResults(e, swapped, true).lenient).toBe(false);
    expect(
      compareResults(
        e,
        {
          columns: ["p", "d"],
          rows: [
            [2, "a"],
            [1, "b"],
          ],
        },
        true,
      ).strict,
    ).toBe(true);
  });
  it("needs whole rows to match, not just columns", () => {
    const e = {
      columns: ["a", "b"],
      rows: [
        [1, "x"],
        [2, "y"],
      ],
    };
    expect(
      compareResults(
        e,
        {
          columns: ["a", "b"],
          rows: [
            [1, "y"],
            [2, "x"],
          ],
        },
        false,
      ).lenient,
    ).toBe(false);
  });
});

describe("run summaries", () => {
  const item = (id: string, lenient: boolean, extra: Partial<EvalItemResult> = {}): EvalItemResult => ({
    id,
    difficulty: "easy",
    outcome: lenient ? "pass" : "wrong_result",
    lenient,
    strict: lenient,
    detail: "",
    sql: "SELECT 1",
    latencyMs: 1000,
    inputTokens: 1000,
    outputTokens: 100,
    auditId: null,
    ...extra,
  });
  it("reports accuracy with Wilson intervals and outcome counts", () => {
    const s = summariseRun([
      item("a", true),
      item("b", true),
      item("c", false),
      item("d", true, { strict: false }),
    ]);
    expect(s.lenient.passes).toBe(3);
    expect(s.strict.passes).toBe(2);
    expect(s.lenient.estimate).toBe(0.75);
    expect(s.lenient.lower).toBeLessThan(0.75);
    expect(s.outcomes.pass).toBe(3);
    expect(s.inputTokens).toBe(4000);
    expect(s.byDifficulty.find((d) => d.difficulty === "easy")!.n).toBe(4);
  });
  it("compares two runs pairwise on the same questions", () => {
    const a = ["a", "b", "c", "d", "e", "f"].map((id, i) => item(id, i < 5));
    const b = ["a", "b", "c", "d", "e", "f"].map((id, i) => item(id, i < 2));
    const c = compareRuns(a, b);
    expect(c).toMatchObject({ n: 6, bothPass: 2, onlyA: 3, onlyB: 0, neither: 1 });
    expect(c.difference.estimate).toBeCloseTo(0.5, 12);
    expect(c.mcnemarP).toBeCloseTo(0.25, 12);
    expect(compareRuns(a, b).difference).toEqual(c.difference); // seeded
  });
  it("prices tokens for the Anthropic models it knows", () => {
    expect(estimateCostUsd("claude-haiku-4-5", 1_000_000, 100_000)).toBeCloseTo(1.5, 12);
    expect(estimateCostUsd("claude-haiku-4-5", 1_000_000, 0, 1_000_000)).toBeCloseTo(0.1, 12);
    expect(estimateCostUsd("some-openai-model", 10, 10)).toBeNull();
  });
  it("has unique question ids", () => {
    expect(new Set(GOLD_QUESTIONS.map((q) => q.id)).size).toBe(GOLD_QUESTIONS.length);
  });
});
