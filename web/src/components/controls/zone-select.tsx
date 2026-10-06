"use client";

import { BOROUGHS } from "@/lib/boroughs";
import { zoneLabels, type ZoneOption } from "@/lib/zone-labels";
import { selectClass } from "./field";

export type { ZoneOption };

/** Native <select> of taxi zones grouped by borough: the keyboard/screen-reader path to every map zone. */
export function ZoneSelect({
  id,
  zones,
  value,
  onChange,
  placeholder = "Choose a zone…",
  allowEmpty = true,
}: {
  id?: string;
  zones: ZoneOption[];
  value: number | null;
  onChange: (id: number | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
}) {
  const groups = BOROUGHS.map((b) => ({
    borough: b,
    zones: zones.filter((z) => z.borough === b).sort((a, c) => a.zone.localeCompare(c.zone) || a.id - c.id),
  })).filter((g) => g.zones.length);
  const labels = zoneLabels(zones);
  return (
    <select
      id={id}
      className={selectClass}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      {allowEmpty && <option value="">{placeholder}</option>}
      {groups.map((g) => (
        <optgroup key={g.borough} label={g.borough}>
          {g.zones.map((z) => (
            <option key={z.id} value={z.id}>
              {labels.get(z.id)}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
