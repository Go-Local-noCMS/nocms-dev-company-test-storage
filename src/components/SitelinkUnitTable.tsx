"use client";

import { useEffect, useState } from "react";
import { callSitelink } from "@/lib/fms-config";

/**
 * One row per unit-type variant from UnitTypePriceList_v2. SiteLink
 * groups identical-config units (same size + features + rate band)
 * into a single row with an availability count. Compared to
 * UnitsInformation_v3 this avoids rendering five identical 5x10
 * rows when the site has five identical 5x10 units.
 */
export interface SitelinkUnitTypeRow {
  /** Stable React key — combination of UnitTypeID and the first-
   *  available UnitID, since the same UnitTypeID can recur across
   *  rows with different rates / configs. */
  key: string;
  typeName: string | null;
  width: number | null;
  length: number | null;
  area: number | null;
  floor: number | null;
  climate: boolean;
  inside: boolean;
  power: boolean;
  alarm: boolean;
  /** Customer-facing monthly rate; prefers dcWebRate, falls back
   *  to dcPreferredRate then dcStdRate. */
  rate: number | null;
  totalVacant: number;
  /** UnitID to hand off to /rent or /reserve. Null when the row's
   *  units are fully occupied. */
  firstAvailableUnitId: string | null;
  /** Display name of the unit we'll hand off (e.g. "A07"). */
  firstAvailableUnitName: string | null;
}

interface SitelinkUnitTableProps {
  sLocationCode: string;
}

function buildRentHref(unitId: string, sLocationCode: string): string {
  const qs = new URLSearchParams({ unitId, sLocationCode }).toString();
  return `/rent?${qs}`;
}

function buildReserveHref(unitId: string, sLocationCode: string): string {
  const qs = new URLSearchParams({ unitId, sLocationCode }).toString();
  return `/reserve?${qs}`;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export function SitelinkUnitTable({ sLocationCode }: SitelinkUnitTableProps) {
  const [rows, setRows] = useState<SitelinkUnitTypeRow[]>([]);
  const [status, setStatus] = useState<"loading" | "ok" | "empty" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    callSitelink<{ sLocationCode: string }, { Table?: unknown; RT?: Array<{ Ret_Code?: number; Ret_Msg?: string | null }> }>(
      "UnitTypePriceList_v2",
      { sLocationCode },
    )
      .then((body) => {
        if (cancelled) return;
        const retCode = body?.RT?.[0]?.Ret_Code;
        if (retCode != null && retCode !== 1) throw new Error(`SiteLink Ret_Code=${retCode}`);
        const raw = body?.Table;
        const rawRows = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const next: SitelinkUnitTypeRow[] = (rawRows as Array<Record<string, unknown>>)
          // Hide fully-occupied rows by default. Remove this filter
          // if you want to render them with a "Waitlist" CTA.
          .filter((r) => Number(r.iTotalVacant ?? 0) > 0)
          .map((r, i) => {
            const w = toNum(r.dcWidth);
            const l = toNum(r.dcLength);
            const area = toNum(r.dcArea) ?? (w != null && l != null ? w * l : null);
            const rate = toNum(r.dcWebRate) ?? toNum(r.dcPreferredRate) ?? toNum(r.dcStdRate);
            const firstId = r.UnitID_FirstAvailable != null ? String(r.UnitID_FirstAvailable) : null;
            const typeId = r.UnitTypeID != null ? String(r.UnitTypeID) : String(i);
            return {
              key: typeId + "-" + (firstId ?? "x") + "-" + i,
              typeName: typeof r.sTypeName === "string" ? r.sTypeName : null,
              width: w,
              length: l,
              area,
              floor: typeof r.iFloor === "number" ? r.iFloor : null,
              climate: r.bClimate === true,
              inside: r.bInside === true,
              power: r.bPower === true,
              alarm: r.bAlarm === true,
              rate,
              totalVacant: Number(r.iTotalVacant ?? 0),
              firstAvailableUnitId: firstId,
              firstAvailableUnitName: typeof r.sUnitName_FirstAvailable === "string" ? r.sUnitName_FirstAvailable : null,
            };
          });
        setRows(next);
        setStatus(next.length === 0 ? "empty" : "ok");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [sLocationCode]);

  if (status === "loading") {
    return <p className="text-sm text-muted" data-nocms-component="sitelink-unit-table">Loading units…</p>;
  }
  if (status === "error") {
    return <p className="text-sm" data-role="text">Could not load unit availability. Try again in a moment.</p>;
  }
  if (status === "empty") {
    return <p className="text-sm" data-role="text-2">No units currently available.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2" data-role="text-3">Size</th>
            <th scope="col" className="px-3 py-2" data-role="text-4">Features</th>
            <th scope="col" className="px-3 py-2" data-role="text-5">Rate</th>
            <th scope="col" className="px-3 py-2" data-role="text-6">Available</th>
            <th scope="col" className="px-3 py-2 text-right" data-role="text-7">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="px-3 py-2 font-mono" data-role="text-8">
                {r.width ?? "?"}&times;{r.length ?? "?"}{r.area != null ? ` (${r.area} sq ft)` : ""}
              </td>
              <td className="px-3 py-2">
                {[r.climate ? "Climate" : null, r.inside ? "Indoor" : null, r.power ? "Power" : null, r.alarm ? "Alarm" : null].filter(Boolean).join(" · ") || (r.typeName ?? "—")}
              </td>
              <td className="px-3 py-2 font-mono">{r.rate != null ? `$${r.rate.toFixed(2)}/mo` : "—"}</td>
              <td className="px-3 py-2">
                {r.totalVacant} {r.totalVacant === 1 ? "unit" : "units"}
              </td>
              <td className="px-3 py-2 text-right">
                {r.firstAvailableUnitId ? (
                  <span className="inline-flex gap-2">
                    <a href={buildReserveHref(r.firstAvailableUnitId, sLocationCode)} data-role="text-9">Reserve</a>
                    <a href={buildRentHref(r.firstAvailableUnitId, sLocationCode)} data-role="text-10">Rent</a>
                  </span>
                ) : (
                  <span data-role="text-11">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
