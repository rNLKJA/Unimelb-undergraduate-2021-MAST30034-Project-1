import "server-only";

import { cache } from "react";
import { eventMatching, rainAnalysis, type EffectsBoroughDay, type EffectsDay } from "@/lib/effects";
import { holdoutTable, type HoldoutDay } from "@/lib/holdout";
import { query } from "./db";

/** Loaders for the rigour, effects and data-quality tables (scripts/build_evidence_tables.py). */

export const BOOTSTRAP_SEED = 20190101;
export const HOLDOUT_B = 2000;
export const EFFECTS_B = 4000;

export const getEvidenceMeta = cache(async () => {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM evidence_meta");
  return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) as {
    ols: {
      rows: number;
      parameters: number;
      r2: number;
      sigma: number;
      cluster_days: number;
      t_cluster: number;
      z: number;
      condition_number: number;
      references: Record<string, { index: number; label: string; trips: number }>;
    };
    splits: { rows: Record<string, number> } & Record<string, unknown>;
    fits: Record<string, Record<string, number>>;
    self_check: Record<string, number>;
    diagnostics: Record<
      string,
      {
        trips: number;
        mean_resid: number;
        sd_resid: number;
        mae: number;
        eta2_sq_resid_borough_hour: number;
        bp_lm_borough_hour: number;
        bp_df: number;
      }
    >;
    conformal: Record<
      string,
      {
        model: string;
        label: string;
        edges: number[];
        n_edge: number;
        n_cal: number;
        n_test: number;
        test_days: number;
        bootstrap: { unit: string; B: number; seed: number; confidence: number };
      }
    >;
    effects_reference: { min_cell: number; cells: number; trips: number; indexed_trips: number };
    data_quality: { raw_rows: number; dropna_rows: number; round1_rows: number; final_rows: number };
  };
});

export interface OlsCoefficient {
  feature_index: number;
  block: string;
  level: number;
  label: string;
  trips: number;
  estimate: number;
  se_classical: number;
  se_hc3: number;
  se_cluster_day: number;
  ci_low_hc3: number;
  ci_high_hc3: number;
  ci_low_cluster: number;
  ci_high_cluster: number;
}

export const getOlsCoefficients = cache(() =>
  query<OlsCoefficient>("SELECT * FROM ols_coefficients ORDER BY feature_index"),
);

export const getHoldoutModels = cache(() =>
  query<{ model: string; label: string }>("SELECT * FROM holdout_models"),
);

export const getHoldout = cache(async () => {
  const rows = await query<HoldoutDay>("SELECT * FROM holdout_daily ORDER BY split, model, date");
  const opts = { B: HOLDOUT_B, seed: BOOTSTRAP_SEED };
  return {
    temporal: holdoutTable(rows, "temporal", "en_2021_spec", opts),
    random: holdoutTable(rows, "random", "en_2021_spec", opts),
  };
});

export interface ResidualBin {
  model: string;
  fitted_lo: number;
  fitted_hi: number;
  trips: number;
  mean_resid: number;
  p10: number;
  p50: number;
  p90: number;
}

export const getResiduals = cache(async () => {
  const [hist, bins, qq, groups] = await Promise.all([
    query<{ model: string; fitted_lo: number; resid_lo: number; trips: number }>(
      "SELECT * FROM residual_hist2d",
    ),
    query<ResidualBin>("SELECT * FROM residual_bins ORDER BY model, fitted_lo"),
    query<{ model: string; p: number; sample_q: number; normal_q: number }>(
      "SELECT * FROM residual_qq ORDER BY model, p",
    ),
    query<{
      model: string;
      group_type: string;
      group_value: string;
      trips: number;
      mean_resid: number;
      sd_resid: number;
      mae: number;
    }>("SELECT * FROM residual_groups"),
  ]);
  return { hist, bins, qq, groups };
});

export interface ConformalCoverageRow {
  scheme: string;
  method: string;
  level: number;
  group_type: string;
  group_value: string;
  trips: number;
  covered: number;
  mean_width: number;
  /** test days with at least one trip in the group */
  days: number;
  /** 95% interval from a bootstrap that resamples whole test days (scripts/rigour.py, seed 20190101) */
  ci_low: number;
  ci_high: number;
}

export const getConformalCoverage = cache(() =>
  query<ConformalCoverageRow>(
    "SELECT * FROM conformal_coverage ORDER BY scheme, method, level, group_type, group_value",
  ),
);

export interface ConformalCoverageDay {
  scheme: string;
  method: string;
  level: number;
  date: string;
  trips: number;
  covered: number;
}

export const getConformalCoverageDaily = cache(() =>
  query<ConformalCoverageDay>("SELECT * FROM conformal_coverage_daily ORDER BY scheme, method, level, date"),
);

export const getConformalBins = cache(() =>
  query<{
    scheme: string;
    method: string;
    level: number;
    borough: string | null;
    bin: number;
    pred_lo: number | null;
    pred_hi: number | null;
    n_cal: number;
    q_lo: number;
    q_hi: number;
  }>("SELECT * FROM conformal_bins ORDER BY scheme, method, level, borough, bin"),
);

export const getEffectsDaily = cache(() => query<EffectsDay>("SELECT * FROM effects_daily ORDER BY date"));
export const getEffectsBoroughDaily = cache(() =>
  query<EffectsBoroughDay>("SELECT * FROM effects_borough_daily ORDER BY date, borough"),
);

export const getRainAnalysis = cache(async () =>
  rainAnalysis(await getEffectsDaily(), { B: EFFECTS_B, seed: BOOTSTRAP_SEED }),
);
export const getEventAnalysis = cache(async () =>
  eventMatching(await getEffectsBoroughDaily(), ["Manhattan", "Brooklyn", "Queens", "Bronx"], {
    B: EFFECTS_B,
    seed: BOOTSTRAP_SEED,
  }),
);

export interface DqRule {
  step: number;
  key: string;
  stage: string;
  label: string;
  rule: string;
  reason: string;
  applied_to: string;
  applied_rows: number;
  removed_in_sequence: number | null;
  fails_alone: number | null;
  fails_only_this: number | null;
}

export const getDataQuality = cache(async () => {
  const [rules, values, missing, january, residual, surcharge] = await Promise.all([
    query<DqRule>("SELECT * FROM dq_rules ORDER BY step"),
    query<{ key: string; rank: number; value: string; rows: number }>(
      "SELECT * FROM dq_rule_values ORDER BY key, rank",
    ),
    query<{ source_file: string; column_name: string; missing: number; rows: number }>(
      "SELECT * FROM dq_missing ORDER BY source_file",
    ),
    query<{ date: string; rows: number; missing_congestion: number }>(
      "SELECT * FROM dq_january ORDER BY date",
    ),
    query<{
      key: string;
      label: string;
      condition: string;
      reason: string;
      rows: number;
      share: number;
      vendor1_rows: number;
      vendor2_rows: number;
      vendor1_trips: number;
      vendor2_trips: number;
    }>("SELECT * FROM dq_residual_checks"),
    query<{ month: number; vendor: number; rows: number; trips: number }>(
      "SELECT * FROM dq_surcharge_by_month ORDER BY month, vendor",
    ),
  ]);
  return { rules, values, missing, january, residual, surcharge };
});
