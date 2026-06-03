"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { callSitelink } from "@/lib/fms-config";

interface UnitDetail {
  id: string;
  name: string | null;
  type: string | null;
  width: number | null;
  length: number | null;
  area: number | null;
  rate: number | null;
  /**
   * true when the unit's type is flagged bExcludeFromInsurance on
   * UnitsInformationByUnitID. Drives the insurance-picker gate —
   * same short-circuit as the PHP reference. Defaults to false so
   * legitimately-insurable units don't accidentally hide the picker.
   */
  excludeFromInsurance: boolean;
  /**
   * true when iInsuranceRequired === 1 on UnitsInformationByUnitID.
   * SiteLink mandates insurance for this unit's type; submitting
   * MoveInWithDiscount_v5 with InsuranceCoverageID=-999 will be
   * rejected. We hide the waive option and force a coverage pick
   * before submit.
   */
  insuranceRequired: boolean;
}

interface ReserveForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  moveInDate: string;
}

const EMPTY_FORM: ReserveForm = {
  firstName: "", lastName: "", email: "", phone: "", moveInDate: "",
};

// Dev-only fixture for the autofill button (see /rent for the rationale).
function devSampleReserveForm(): ReserveForm {
  const moveIn = new Date();
  moveIn.setDate(moveIn.getDate() + 7);
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    firstName: "Testy",
    lastName: "McTestface",
    email: "testy.mctestface+" + suffix + "@example.com",
    phone: "5555550199",
    moveInDate: moveIn.toISOString().slice(0, 10),
  };
}

function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "k-" + Date.now() + "-" + Math.random().toString(36).slice(2);
  }
}

interface SubmitInput {
  sLocationCode: string;
  unitId: string;
  form: ReserveForm;
}

interface SubmitResult {
  reservationId: number;
  tenantId: number;
  accessCode: string;
}

/**
 * Two-step orchestration from the browser:
 *   1. TenantNewDetailed_v3 → TenantID (so the reservation has an owner)
 *   2. ReservationNewWithSource_v5 (QTRentalTypeID=1, QUOTE) → soft
 *      reservation id returned in RT[0].Ret_Code.
 */
async function submitReservation(input: SubmitInput): Promise<SubmitResult> {
  const { sLocationCode, unitId, form } = input;

  function post<T = unknown>(method: string, body: unknown): Promise<T> {
    return callSitelink<unknown, T>(method, body, { idempotencyKey: newIdempotencyKey() });
  }

  // 1. Tenant — bare minimum to satisfy SiteLink validation. Address
  // fields default to empty strings; SiteLink accepts them on
  // reservation flows even though they're required for a real rental.
  const tenantBody = {
    sLocationCode,
    sFName: form.firstName,
    sLName: form.lastName,
    bCommercial: false,
    bCompanyIsTenant: false,
    bSMSOptIn: false,
    sGateCode: "",
    sWebPassword: "",
    sAddr1: "",
    sAddr2: "",
    sCity: "",
    sRegion: "",
    sPostalCode: "",
    sCountry: "US",
    sPhone: form.phone,
    sEmail: form.email,
    sMobile: form.phone,
    dDOB: "1700-01-01T00:00:00",
    sLicense: "",
    sLicRegion: "",
  };
  const tenant = await post<{ RT: Array<{ Ret_Code: number; TenantID?: number; AccessCode?: string; Ret_Msg?: string | null }> }>(
    "TenantNewDetailed_v3",
    tenantBody,
  );
  const tenantRT = tenant.RT?.[0];
  if (!tenantRT || tenantRT.Ret_Code <= 0 || !tenantRT.TenantID) {
    throw new Error("TenantNewDetailed_v3 failed: " + (tenantRT?.Ret_Msg ?? "no tenant id returned"));
  }
  const tenantId = tenantRT.TenantID;
  const accessCode = tenantRT.AccessCode ?? "";

  // 2. Reservation — QTRentalTypeID=1 is QUOTE (soft hold, no
  // physical commitment). QTRentalTypeID=2 (ORDER) is what /rent uses
  // when converting straight to a lease.
  const reservationBody = {
    sLocationCode,
    sTenantID: String(tenantId),
    sUnitID: String(unitId),
    dNeeded: form.moveInDate + "T00:00:00",
    sSource: "Web",
    QTRentalTypeID: 1,
    ConcessionID: -999,
    iSource: 5,
    iInquiryType: 2,
  };
  const reservation = await post<{ RT: Array<{ Ret_Code: number; Ret_Msg?: string | null }> }>(
    "ReservationNewWithSource_v5",
    reservationBody,
  );
  const reservationRT = reservation.RT?.[0];
  if (!reservationRT || reservationRT.Ret_Code <= 0) {
    throw new Error("ReservationNewWithSource_v5 failed: " + (reservationRT?.Ret_Msg ?? "no reservation id returned"));
  }
  return { reservationId: reservationRT.Ret_Code, tenantId, accessCode };
}

export default function ReservePage() {
  const params = useSearchParams();
  const unitId = params.get("unitId") ?? "";
  const sLocationCode = params.get("sLocationCode") ?? "";
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [form, setForm] = useState<ReserveForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!unitId || !sLocationCode) {
      setUnitError("Missing unit information. Open this page from the unit table.");
      return;
    }
    let cancelled = false;
    callSitelink<{ sLocationCode: string; UnitID: number }, { Table?: unknown; RT?: Array<{ Ret_Code?: number; Ret_Msg?: string | null }> }>(
      "UnitsInformationByUnitID",
      { sLocationCode, UnitID: Number(unitId) },
    )
      .then((body) => {
        if (cancelled) return;
        const retCode = body?.RT?.[0]?.Ret_Code;
        if (retCode != null && retCode !== 1) throw new Error("SiteLink Ret_Code=" + retCode);
        const rows = Array.isArray(body?.Table) ? (body.Table as Array<Record<string, unknown>>) : [];
        const u = rows[0];
        if (!u) throw new Error("Unit not found");
        const w = u.dcWidth != null ? Number(u.dcWidth) : null;
        const l = u.dcLength != null ? Number(u.dcLength) : null;
        const area = u.dcArea != null ? Number(u.dcArea) : (w != null && l != null ? w * l : null);
        const rate = u.dcWebRate != null ? Number(u.dcWebRate) : (u.dcStdRate != null ? Number(u.dcStdRate) : null);
        setUnit({
          id: u.UnitID != null ? String(u.UnitID) : unitId,
          name: typeof u.sUnitName === "string" ? u.sUnitName : null,
          type: typeof u.sTypeName === "string" ? u.sTypeName : null,
          width: Number.isFinite(w as number) ? w : null,
          length: Number.isFinite(l as number) ? l : null,
          area: Number.isFinite(area as number) ? area : null,
          rate: Number.isFinite(rate as number) ? rate : null,
          excludeFromInsurance: u.bExcludeFromInsurance === true,
          insuranceRequired: Number(u.iInsuranceRequired ?? 0) === 1,
        });
      })
      .catch((e: unknown) => {
        if (!cancelled) setUnitError(String((e as { message?: string })?.message ?? e));
      });
    return () => { cancelled = true; };
  }, [unitId, sLocationCode]);

  function update<K extends keyof ReserveForm>(field: K, value: ReserveForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const required: Array<[keyof ReserveForm, string]> = [
      ["firstName", "First name"], ["lastName", "Last name"],
      ["email", "Email"], ["phone", "Phone"],
      ["moveInDate", "Move-in date"],
    ];
    const missing = required.find(([k]) => !form[k]?.toString().trim());
    if (missing) { setError(missing[1] + " is required."); return; }
    setSubmitting(true);
    submitReservation({ sLocationCode, unitId, form })
      .then((r) => { setResult(r); setSubmitted(true); })
      .catch((err: unknown) => setError(String((err as { message?: string })?.message ?? err)))
      .finally(() => setSubmitting(false));
  }

  const rentHref = "/rent?" + new URLSearchParams({ unitId, sLocationCode }).toString();

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-semibold" data-role="heading">Reserve a unit</h1>
      {unitError ? <p className="text-sm text-red-600">{unitError}</p> : null}
      {unit ? (
        <section className="rounded-md border p-4 text-sm space-y-1">
          <div><strong data-role="text">Unit:</strong> {unit.name ?? unit.id}</div>
          {unit.type ? <div><strong data-role="text-2">Type:</strong> {unit.type}</div> : null}
          {unit.width != null && unit.length != null ? (
            <div><strong data-role="text-3">Size:</strong> {unit.width}&times;{unit.length}{unit.area != null ? " (" + unit.area + " sq ft)" : ""}</div>
          ) : null}
          {unit.rate != null ? <div><strong data-role="text-4">Rate:</strong> {"$" + unit.rate.toFixed(2)} / month</div> : null}
        </section>
      ) : !unitError ? <p className="text-sm opacity-70" data-role="text-5">Loading unit…</p> : null}

      {submitted && result ? (
        <section className="rounded-md border p-4 space-y-2">
          <p className="font-medium" data-role="text-6">Reservation confirmed.</p>
          <p className="text-sm" data-role="text-7">Confirmation #: <span className="font-mono">{result.reservationId}</span></p>
          {result.accessCode ? (
            <p className="text-sm" data-role="text-8">Gate code: <span className="font-mono">{result.accessCode}</span></p>
          ) : null}
          <p className="text-sm pt-2" data-role="text-9">
            Ready to complete the rental?{" "}
            <a className="underline" href={rentHref} data-role="text-10">Continue to checkout</a>
          </p>
        </section>
      ) : (
        <>
          {process.env.NEXT_PUBLIC_DEV_AUTOFILL === "true" && (
            <button
              type="button"
              onClick={() => setForm(devSampleReserveForm())}
              className="self-start rounded-md border border-dashed px-3 py-1 text-xs opacity-75 hover:opacity-100" data-role="text-11"
            >
              Fill test data (dev only)
            </button>
          )}
          <form onSubmit={handleSubmit} className="grid gap-3">
          <Field label="First name" value={form.firstName} onChange={(v) => update("firstName", v)} required />
          <Field label="Last name" value={form.lastName} onChange={(v) => update("lastName", v)} required />
          <Field label="Email" type="email" value={form.email} onChange={(v) => update("email", v)} required />
          <Field label="Phone" type="tel" value={form.phone} onChange={(v) => update("phone", v)} required />
          <Field label="Move-in date" type="date" value={form.moveInDate} onChange={(v) => update("moveInDate", v)} required />

          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting || !unit}
            className="rounded-md bg-foreground text-background px-4 py-2 disabled:opacity-50"
          >
            {submitting ? "Reserving…" : "Reserve unit"}
          </button>
          <p className="text-xs opacity-70" data-role="text-12">
            This is a soft hold — no payment is collected. Use the Rent
            link on the unit table to check out and pay.
          </p>
        </form>
        </>
      )}
    </main>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
}) {
  const { label, value, onChange, type = "text", required } = props;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span>{label}{required ? " *" : ""}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-md border px-3 py-2 bg-background"
      />
    </label>
  );
}
