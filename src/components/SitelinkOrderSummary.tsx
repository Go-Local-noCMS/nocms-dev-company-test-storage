"use client";

import { useEffect, useState } from "react";
import { callSitelink } from "@/lib/fms-config";

export interface OrderLine {
  label: string;
  amount: number;
  kind?: "charge" | "tax" | "discount" | "total";
}

interface SitelinkOrderSummaryProps {
  sLocationCode: string;
  unitId: string;
  /** ISO move-in date (YYYY-MM-DD). When empty/falsy, the summary
   *  shows a placeholder instead of fetching. */
  moveInDate: string;
  /** Promotion / discount-plan id. 0 = no discount. */
  promotionId?: number;
  /** Insurance coverage id. 0 = no insurance line. */
  insuranceCoverageId?: number;
}

function asCurrency(n: number): string {
  return (n < 0 ? "-$" : "$") + Math.abs(n).toFixed(2);
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export function SitelinkOrderSummary({
  sLocationCode,
  unitId,
  moveInDate,
  promotionId = 0,
  insuranceCoverageId = 0,
}: SitelinkOrderSummaryProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [lines, setLines] = useState<OrderLine[]>([]);
  const [recurringMonthly, setRecurringMonthly] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!moveInDate || !unitId || !sLocationCode) {
      setStatus("idle");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);
    callSitelink<
      { sLocationCode: string; iUnitID: number; dMoveInDate: string; ConcessionPlanID: number; InsuranceCoverageID: number },
      { Table?: unknown; RT?: Array<{ Ret_Code?: number | string; Ret_Msg?: string | null }> }
    >(
      "MoveInCostRetrieveWithDiscount_v2",
      {
        sLocationCode,
        iUnitID: Number(unitId),
        dMoveInDate: moveInDate,
        // Real Sitelink param names — no `i` prefix on these two.
        // Sending iDiscountPlanID/iInsuranceCoverageID silently no-ops
        // them and Sitelink omits the discount/insurance from the
        // response. Discovered the hard way (see api.storageessentials).
        ConcessionPlanID: promotionId,
        InsuranceCoverageID: insuranceCoverageId,
      },
    )
      .then((body) => {
        if (cancelled) return;
        // Top-level RT is often empty for this method; per-row Ret_Code
        // is the real success signal. Only treat top-level RT as a fatal
        // error when it has an entry with a non-1 code.
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

        // Sitelink returns BOTH move-in charges and recurring monthly
        // charges (e.g. insurance premium) in the same Table —
        // differentiated by bMoveInRequired. "true" rows go into the
        // "Due today" total; "false" rows are recurring and show
        // alongside the monthly rent below.
        const next: OrderLine[] = [];
        let total = 0;
        let totalDiscount = 0;
        let recurringInsurance: number | null = null;

        for (const row of rows) {
          // Skip rows Sitelink flagged as failed.
          if (row.Ret_Code != null && Number(row.Ret_Code) !== 1) continue;

          const description = typeof row.ChargeDescription === "string" ? row.ChargeDescription : "Charge";
          const charge = toNum(row.ChargeAmount);
          const tax = toNum(row.dcTax1) ?? toNum(row.TaxAmount);
          const lineTotal = toNum(row.dcTotal);
          const discount = toNum(row.dcDiscount);
          const moveInRequired = row.bMoveInRequired === true || row.bMoveInRequired === "true";

          if (!moveInRequired) {
            // Recurring monthly charge — typically the insurance premium.
            if (description.toLowerCase().includes("insurance") || description.toLowerCase().includes("protection")) {
              if (charge != null && charge > 0) recurringInsurance = (recurringInsurance ?? 0) + charge;
            }
            continue;
          }

          if (charge != null && charge !== 0) {
            next.push({ label: description, amount: charge, kind: "charge" });
          }
          if (tax != null && tax > 0) {
            next.push({ label: description + " · tax", amount: tax, kind: "tax" });
          }
          if (discount != null && discount > 0) {
            totalDiscount += discount;
          }
          if (lineTotal != null) {
            total += lineTotal;
          } else if (charge != null) {
            total += charge + (tax ?? 0);
          }
        }

        if (totalDiscount > 0) {
          next.push({ label: "Discount", amount: -totalDiscount, kind: "discount" });
          total -= totalDiscount;
        }

        next.push({ label: "Due today", amount: total, kind: "total" });

        // Recurring monthly rent: pull from the first row carrying
        // WebRate / dcTenantRate. The "First Monthly Rent" charge above
        // is prorated, not the full recurring amount.
        let baseMonthly: number | null = null;
        for (const row of rows) {
          const web = toNum(row.WebRate);
          const tenant = toNum(row.dcTenantRate);
          if (web != null && web > 0) { baseMonthly = web; break; }
          if (tenant != null && tenant > 0) { baseMonthly = tenant; break; }
        }
        // Add insurance premium to the recurring total if one was
        // selected — that's what the customer is committing to monthly.
        setRecurringMonthly(
          baseMonthly == null && recurringInsurance == null
            ? null
            : (baseMonthly ?? 0) + (recurringInsurance ?? 0),
        );

        setLines(next);
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
  }, [sLocationCode, unitId, moveInDate, promotionId, insuranceCoverageId]);

  return (
    <aside aria-labelledby="order-summary-heading" className="rounded-md border p-4" data-nocms-component="sitelink-order-summary">
      <h2 id="order-summary-heading" className="text-sm font-semibold uppercase tracking-wider mb-3" data-role="heading">
        Order summary
      </h2>
      {status === "idle" && (
        <p className="text-sm" data-role="text">Select a move-in date to see pricing.</p>
      )}
      {status === "loading" && (
        <ul className="space-y-2" aria-busy="true">
          {[1, 2, 3, 4].map((i) => (
            <li key={i} className="flex justify-between animate-pulse">
              <span className="h-4 w-32 bg-current opacity-10 rounded" />
              <span className="h-4 w-16 bg-current opacity-10 rounded" />
            </li>
          ))}
        </ul>
      )}
      {status === "error" && (
        <p className="text-sm" role="alert" data-role="text-2">
          Couldn&apos;t load pricing: {error}
        </p>
      )}
      {status === "ok" && (
        <>
          <ul className="space-y-2">
            {lines.map((line, i) => (
              <li
                key={i}
                className={
                  line.kind === "total"
                    ? "flex justify-between border-t pt-2 mt-2 font-bold"
                    : line.kind === "tax"
                    ? "flex justify-between text-xs pl-3 opacity-70"
                    : "flex justify-between text-sm"
                }
              >
                <span>{line.label}</span>
                <span className="font-mono">{asCurrency(line.amount)}</span>
              </li>
            ))}
          </ul>
          {recurringMonthly != null && recurringMonthly > 0 && (
            <p className="text-xs mt-3" data-role="text-3">
              Then {asCurrency(recurringMonthly)} / month, billed monthly.
            </p>
          )}
        </>
      )}
    </aside>
  );
}
