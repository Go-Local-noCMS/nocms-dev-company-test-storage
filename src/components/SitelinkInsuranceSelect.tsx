"use client";

import { useEffect, useId, useState } from "react";
import { callSitelink } from "@/lib/fms-config";

export interface InsuranceOption {
  id: number;
  name: string;
  monthlyRate: number | null;
  coverageAmount: number | null;
  provider: string | null;
  brochureUrl: string | null;
}

interface SitelinkInsuranceSelectProps {
  sLocationCode: string;
  /** Currently selected coverage id (InsurCoverageID). 0 = waived. */
  value: number;
  onChange: (coverageId: number) => void;
  label?: string;
  /**
   * Set to true when the unit's type is flagged bExcludeFromInsurance
   * on UnitsInformationByUnitID. Renders a small notice instead of
   * the picker and skips the coverage fetch entirely — matches the
   * PHP reference's SiteLinkService::getInsuranceOptions short-circuit.
   * The caller must also keep `value` at 0 (-999 sentinel
   * downstream) so MoveInWithDiscount_v5 doesn't reject the rental.
   */
  excluded?: boolean;
  /**
   * Set to true when iInsuranceRequired === 1 on the unit. The
   * picker hides the "Waive insurance" choice — without a positive
   * coverage id the move-in call will be rejected by SiteLink.
   * Wins over `excluded` if both are passed (the unit is mis-
   * configured at the FMS in that case; we surface the required
   * gate as the more actionable one).
   */
  required?: boolean;
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function asCurrency(n: number): string {
  return "$" + n.toFixed(2);
}

export function SitelinkInsuranceSelect({
  sLocationCode,
  value,
  onChange,
  label = "Insurance coverage",
  excluded = false,
  required = false,
}: SitelinkInsuranceSelectProps) {
  const selectId = useId();
  const [status, setStatus] = useState<"loading" | "ok" | "empty" | "error">("loading");
  const [options, setOptions] = useState<InsuranceOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Force the selection back to "waived" the moment we learn this unit
  // can't take insurance — guards callers that mounted the component
  // with a stale value from a previous unit.
  useEffect(() => {
    if (excluded && value !== 0) onChange(0);
  }, [excluded, value, onChange]);

  // When the unit mandates insurance and the current pick is 0
  // (the default after navigation), auto-select the first option
  // as soon as the coverage list loads. The user can still change
  // it, but we never let the form submit with a waive that
  // SiteLink will reject.
  useEffect(() => {
    if (required && value === 0 && options.length > 0) {
      onChange(options[0].id);
    }
  }, [required, value, options, onChange]);

  useEffect(() => {
    if (!sLocationCode || excluded) return;
    let cancelled = false;
    setStatus("loading");
    setError(null);
    callSitelink<{ sLocationCode: string }, { Table?: unknown; RT?: Array<{ Ret_Code?: number | string; Ret_Msg?: string | null }> }>(
      "InsuranceCoverageRetrieve_V2",
      { sLocationCode },
    )
      .then((body) => {
        if (cancelled) return;
        const topRet = body?.RT?.[0]?.Ret_Code;
        if (topRet != null && Number(topRet) !== 1) {
          throw new Error("Sitelink Ret_Code=" + topRet);
        }
        const rawTable = body?.Table;
        const rows: Array<Record<string, unknown>> = Array.isArray(rawTable)
          ? (rawTable as Array<Record<string, unknown>>)
          : rawTable
          ? [rawTable as Record<string, unknown>]
          : [];
        const next: InsuranceOption[] = rows
          .map((r) => {
            const id = toNum(r.InsurCoverageID) ?? toNum(r.iCoverageID) ?? 0;
            return {
              id: Math.trunc(id),
              name:
                (typeof r.sCoverageName === "string" && r.sCoverageName) ||
                (typeof r.sCoverageDesc === "string" && r.sCoverageDesc) ||
                "Coverage",
              monthlyRate: toNum(r.dcMonthlyRate) ?? toNum(r.dcPremium),
              coverageAmount: toNum(r.dcCoverageAmount) ?? toNum(r.dcCoverage),
              provider: typeof r.sProvidor === "string" ? r.sProvidor : null,
              brochureUrl: typeof r.sBrochureUrl === "string" ? r.sBrochureUrl : null,
            };
          })
          .filter((o) => o.id > 0);
        if (next.length === 0) {
          setStatus("empty");
          return;
        }
        setOptions(next);
        setStatus("ok");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e?.message ?? e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sLocationCode, excluded]);

  if (excluded) {
    return (
      <div className="flex flex-col gap-1 text-sm" data-nocms-component="sitelink-insurance-select">
        <span className="font-medium">{label}</span>
        <span className="text-xs opacity-75" data-role="text">
          This unit isn&apos;t eligible for insurance.
        </span>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs" data-role="text-2">Loading coverage options…</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs" role="alert" data-role="text-3">
          Couldn&apos;t load coverage options: {error}
        </span>
      </div>
    );
  }

  if (status === "empty") {
    return null;
  }

  return (
    <label htmlFor={selectId} className="flex flex-col gap-1 text-sm">
      <span className="font-medium">
        {label}{required ? <span className="ml-1 text-xs" data-role="text-4">(required)</span> : null}
      </span>
      <select
        id={selectId}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-md border px-3 py-2 bg-background"
      >
        {/* Waive option is hidden when the unit's type mandates
            insurance — submitting MoveInWithDiscount_v5 with
            InsuranceCoverageID=-999 on a required-insurance unit
            is rejected by SiteLink. */}
        {required ? null : <option value={0}>Waive insurance</option>}
        {options.map((o) => {
          const parts: string[] = [];
          if (o.coverageAmount != null && o.coverageAmount > 0) {
            parts.push(asCurrency(o.coverageAmount) + " coverage");
          } else {
            parts.push(o.name);
          }
          if (o.monthlyRate != null && o.monthlyRate > 0) {
            parts.push(asCurrency(o.monthlyRate) + "/mo");
          }
          if (o.provider) {
            parts.push("via " + o.provider);
          }
          return (
            <option key={o.id} value={o.id}>
              {parts.join(" — ")}
            </option>
          );
        })}
      </select>
      <span className="text-xs opacity-70" data-role="text-5">
        Coverage is added to your monthly bill. Waiving requires proof of your own policy.
      </span>
    </label>
  );
}
