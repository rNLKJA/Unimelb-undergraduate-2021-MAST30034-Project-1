import type { Metadata } from "next";
import { Estimator, type EstimatorZone } from "@/components/estimate/estimator";
import { PageHeader } from "@/components/page-header";
import { formatFixed } from "@/lib/format";
import model from "@/lib/data/model.json";
import { getConditions, getMapZones } from "@/server/analytics";

export const metadata: Metadata = {
  title: "Estimate a trip",
  description:
    "Run the 2021 MAST30034 trip-duration regression in your browser and see every term behind the prediction.",
};

const DEFAULT = { pu: 161, do: 132 }; // Midtown Center -> JFK Airport

export default async function EstimatePage({ searchParams }: PageProps<"/estimate">) {
  const sp = await searchParams;
  const [zones, conditions] = await Promise.all([getMapZones(), getConditions()]);
  const data: EstimatorZone[] = zones
    .filter((z) => z.centroid_lon !== null && z.centroid_lat !== null)
    .map((z) => ({
      id: z.location_id,
      zone: z.zone,
      borough: z.borough,
      modelName: z.model_zone_name,
      lon: z.centroid_lon!,
      lat: z.centroid_lat!,
    }));
  const pick = (v: string | string[] | undefined, fallback: number) => {
    const n = Number(Array.isArray(v) ? v[0] : v);
    return data.some((z) => z.id === n) ? n : fallback;
  };
  const s = model.summary;
  return (
    <>
      <PageHeader kicker="Estimate a trip" title="How long will it take?">
        <p>
          The regression from the 2021 notebook, running in your browser: 579 features, the original
          coefficients from fold 1 of its 10-fold cross-validation. Across the folds it explained{" "}
          {formatFixed(s.notebook_mean_r2 * 100, 1)}% of the variance with a typical error of{" "}
          {formatFixed(s.notebook_mean_rmse, 1)} minutes, so read it as a rough guide, not a promise.
        </p>
      </PageHeader>
      <Estimator
        zones={data}
        conditions={conditions}
        initial={{ pu: pick(sp.pu, DEFAULT.pu), do: pick(sp.do, DEFAULT.do) }}
      />
    </>
  );
}
