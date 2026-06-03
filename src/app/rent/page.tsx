"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { callSitelink } from "@/lib/fms-config";
import { SitelinkOrderSummary } from "@/components/SitelinkOrderSummary";
import { SitelinkInsuranceSelect } from "@/components/SitelinkInsuranceSelect";

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

// Fields collected from the user. Maps into the SiteLink
// SOAP-method bodies inside submitRental(). Mirrors
// api.storageessentials.io.local's MakeRentalRequestData
// validated DTO.
interface RentForm {
  // Tenant identity
  firstName: string;
  lastName: string;
  dob: string;
  email: string;
  phone: string;
  // Home address
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  // ID
  driversLicenseNumber: string;
  driversLicenseState: string;
  // Lease
  moveInDate: string;
  // Tenant account (for post-rental portal login)
  tenantPassword: string;
  // Payment (credit card)
  ccHolderName: string;
  ccNumber: string;
  ccExpireMonth: string;
  ccExpireYear: string;
  ccCvv: string;
  // Billing address (only used when billingSameAsHome === false)
  billingAddressLine1: string;
  billingAddressLine2: string;
  billingCity: string;
  billingState: string;
  billingZip: string;
  billingCountry: string;
  // Misc
  promotionCode: string;
  agreementSignature: string;
}

const EMPTY_FORM: RentForm = {
  firstName: "", lastName: "", dob: "", email: "", phone: "",
  addressLine1: "", addressLine2: "", city: "", state: "", zip: "", country: "US",
  driversLicenseNumber: "", driversLicenseState: "",
  moveInDate: "",
  tenantPassword: "",
  ccHolderName: "", ccNumber: "", ccExpireMonth: "", ccExpireYear: "", ccCvv: "",
  billingAddressLine1: "", billingAddressLine2: "", billingCity: "",
  billingState: "", billingZip: "", billingCountry: "US",
  promotionCode: "",
  agreementSignature: "",
};

// Deterministic dev fixture for the autofill button. Values are
// chosen to pass SiteLink's validation: 4111... is the standard test
// PAN, the expiry is always in the future, the state/zip are valid US
// values, and the email gets a per-load random suffix so re-running
// the funnel against test mode doesn't trip duplicate-tenant checks.
// Only emitted when NEXT_PUBLIC_DEV_AUTOFILL=true (build-time inline).
function devSampleRentForm(): RentForm {
  const today = new Date();
  const moveIn = new Date(today);
  moveIn.setDate(moveIn.getDate() + 7);
  const moveInDate = moveIn.toISOString().slice(0, 10);
  const expiry = new Date(today);
  expiry.setFullYear(expiry.getFullYear() + 3);
  const ccExpireMonth = String(expiry.getMonth() + 1).padStart(2, "0");
  const ccExpireYear = String(expiry.getFullYear()).slice(2);
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    firstName: "Testy",
    lastName: "McTestface",
    dob: "1990-01-15",
    email: "testy.mctestface+" + suffix + "@example.com",
    phone: "5555550199",
    addressLine1: "123 Test Street",
    addressLine2: "",
    city: "Seattle",
    state: "WA",
    zip: "98101",
    country: "US",
    driversLicenseNumber: "TEST" + suffix.toUpperCase(),
    driversLicenseState: "WA",
    moveInDate,
    tenantPassword: "testpassword123",
    ccHolderName: "Testy McTestface",
    ccNumber: "4111111111111111",
    ccExpireMonth,
    ccExpireYear,
    ccCvv: "123",
    billingAddressLine1: "",
    billingAddressLine2: "",
    billingCity: "",
    billingState: "",
    billingZip: "",
    billingCountry: "US",
    promotionCode: "",
    agreementSignature: "Testy McTestface",
  };
}

// SiteLink credit-card type ids (from MoveInWithDiscount_v5 enum):
// 0 = none, 5 = Visa, 6 = MasterCard, 7 = American Express, 8 = Discover, 9 = Debit.
function detectCcType(number: string): number {
  const n = number.replace(/\s|-/g, "");
  if (/^4/.test(n)) return 5;
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 6;
  if (/^3[47]/.test(n)) return 7;
  if (/^6(?:011|5)/.test(n)) return 8;
  return 0;
}

// Browser's crypto.randomUUID is fine for an Idempotency-Key — we
// just need a 1-per-write unique value the connector echoes back.
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
  form: RentForm;
  insuranceCoverageId: number;
  enableAutoPay: boolean;
  billingSameAsHome: boolean;
}

interface SubmitResult {
  leaseNumber: number | null;
  ledgerId: number;
  tenantId: number;
  accessCode: string;
  signingUrl: string | null;
  esignError: string | null;
}

/**
 * Full SiteLink rental orchestration, all from the browser:
 *   1. TenantNewDetailed_v3       → TenantID
 *   2. ReservationNewWithSource_v5 → reservation id (= WaitingID)
 *   3. MoveInCostRetrieveWithDiscount_v2 → dStartDate / dEndDate /
 *      dcPaymentAmount (sum of bMoveInRequired rows)
 *   4. MoveInWithDiscount_v5       → iLeaseNum (success)
 *
 * Each WRITE gets its own Idempotency-Key so user retries don't
 * double-charge or duplicate records.
 *
 * Card details (sCreditCardNumber, sCreditCardCVV) go straight from
 * the browser to the SiteLink connector. **This is acceptable only
 * because the SiteLink endpoint terminates the card data
 * server-side** — there's no third-party processor in the chain.
 * Route through a server-side proxy if your deployment changes
 * that assumption.
 */
async function submitRental(input: SubmitInput): Promise<SubmitResult> {
  const { sLocationCode, unitId, form, insuranceCoverageId, enableAutoPay, billingSameAsHome } = input;
  void enableAutoPay;

  function post<T = unknown>(method: string, body: unknown, idempotent: boolean): Promise<T> {
    return callSitelink<unknown, T>(method, body, idempotent ? { idempotencyKey: newIdempotencyKey() } : undefined);
  }

  // 1. Tenant
  const dob = form.dob ? form.dob + "T00:00:00" : "1700-01-01T00:00:00";
  const tenantBody = {
    sLocationCode,
    sFName: form.firstName,
    sLName: form.lastName,
    bCommercial: false,
    bCompanyIsTenant: false,
    bSMSOptIn: false,
    sGateCode: "",
    sWebPassword: form.tenantPassword,
    sAddr1: form.addressLine1,
    sAddr2: form.addressLine2,
    sCity: form.city,
    sRegion: form.state,
    sPostalCode: form.zip,
    sCountry: form.country,
    sPhone: form.phone,
    sEmail: form.email,
    sMobile: form.phone,
    dDOB: dob,
    sLicense: form.driversLicenseNumber,
    sLicRegion: form.driversLicenseState,
  };
  const tenant = await post<{ RT: Array<{ Ret_Code: number; TenantID?: number; AccessCode?: string; Ret_Msg?: string | null }> }>(
    "TenantNewDetailed_v3",
    tenantBody,
    true,
  );
  const tenantRT = tenant.RT?.[0];
  if (!tenantRT || tenantRT.Ret_Code <= 0 || !tenantRT.TenantID) {
    throw new Error("TenantNewDetailed_v3 failed: " + (tenantRT?.Ret_Msg ?? "no tenant id returned"));
  }
  const tenantId = tenantRT.TenantID;
  const accessCode = tenantRT.AccessCode ?? "";

  // 2. Reservation
  const reservationBody = {
    sLocationCode,
    sTenantID: String(tenantId),
    sUnitID: String(unitId),
    dNeeded: form.moveInDate + "T00:00:00",
    sSource: "Web",
    QTRentalTypeID: 2,
    // ReservationNewWithSource_v5 doesn't take InsuranceCoverageID
    // — that's set at the cost-quote and move-in steps.
    ConcessionID: -999,
    iSource: 5,
    iInquiryType: 2,
  };
  const reservation = await post<{ RT: Array<{ Ret_Code: number; Ret_Msg?: string | null }> }>(
    "ReservationNewWithSource_v5",
    reservationBody,
    true,
  );
  const reservationRT = reservation.RT?.[0];
  if (!reservationRT || reservationRT.Ret_Code <= 0) {
    throw new Error("ReservationNewWithSource_v5 failed: " + (reservationRT?.Ret_Msg ?? "no reservation id returned"));
  }
  const waitingId = reservationRT.Ret_Code;

  // 3. Move-in cost quote (read-only).
  // **Use the _Reservation variant** because we just created one —
  // it factors in any rate lock / tax adjustment from the reservation
  // context. Calling the non-reservation _v2 here returns a slightly
  // different total than MoveInWithDiscount_v5 then expects, and the
  // rental call fails with Ret_Code=-11 "Payment amount does not match".
  const costsBody = {
    sLocationCode,
    iUnitID: Number(unitId),
    dMoveInDate: form.moveInDate,
    ConcessionPlanID: -999,
    InsuranceCoverageID: insuranceCoverageId || -999,
    WaitingID: waitingId,
  };
  const costs = await post<{ Table?: Array<Record<string, unknown>>; RT?: Array<{ Ret_Code?: number; Ret_Msg?: string | null }> }>(
    "MoveInCostRetrieveWithDiscount_Reservation",
    costsBody,
    false,
  );
  const rows = Array.isArray(costs.Table) ? costs.Table : [];
  const moveInRows = rows.filter((r) => r.bMoveInRequired === true || r.bMoveInRequired === "true" || r.bMoveInRequired === undefined);
  if (moveInRows.length === 0) {
    throw new Error("MoveInCostRetrieveWithDiscount_v2 returned no move-in charges");
  }
  const num = (v: unknown): number => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? "0"));
    return Number.isFinite(n) ? n : 0;
  };
  const dStartDate = String(moveInRows[0].StartDate ?? form.moveInDate + "T00:00:00");
  const dEndDate = String(moveInRows[0].EndDate ?? form.moveInDate + "T23:59:59");
  const dcPaymentAmount = moveInRows.reduce((acc, r) => acc + num(r.dcTotal), 0);

  // 4. Move-in commit
  const ccType = detectCcType(form.ccNumber);
  const expYear2 = form.ccExpireYear.padStart(2, "0").slice(0, 2);
  const expMonth2 = form.ccExpireMonth.padStart(2, "0").slice(0, 2);
  const dExpirationDate = "20" + expYear2 + "-" + expMonth2 + "-01T00:00:00";
  const billingAddress = billingSameAsHome ? form.addressLine1 : form.billingAddressLine1;
  const billingZip = billingSameAsHome ? form.zip : form.billingZip;
  const moveInBody = {
    sLocationCode,
    TenantID: tenantId,
    UnitID: Number(unitId),
    dStartDate,
    dEndDate,
    dcPaymentAmount,
    iCreditCardType: ccType,
    dExpirationDate,
    bUsePushRate: false,
    iPayMethod: 0,
    iBillingFrequency: 3,
    sAccessCode: accessCode,
    sCreditCardNumber: form.ccNumber.replace(/\s|-/g, ""),
    sCreditCardCVV: form.ccCvv,
    sBillingName: form.ccHolderName,
    sBillingAddress: billingAddress,
    sBillingZipCode: billingZip,
    InsuranceCoverageID: insuranceCoverageId || -999,
    WaitingID: waitingId,
    ConcessionPlanID: -999,
    // Dev tier: every rental is a test transaction so cards aren't actually
    // charged. Flip to false once a real payment processor is wired in.
    bTestMode: true,
  };
  const rental = await post<{ RT: Array<{ Ret_Code: number; Ret_Msg?: string | null }>; iLeaseNum?: number | null; iLedgerID?: number | null }>(
    "MoveInWithDiscount_v5",
    moveInBody,
    true,
  );
  const rentalRT = rental.RT?.[0];
  if (!rentalRT || rentalRT.Ret_Code <= 0) {
    throw new Error("MoveInWithDiscount_v5 failed: " + (rentalRT?.Ret_Msg ?? "rental rejected by Sitelink"));
  }
  // SiteLink overloads MoveInWithDiscount_v5's RT[0].Ret_Code to carry
  // the new ledger id when the rental succeeds. That's the iLedgerID
  // the eSign call needs — it is NOT the lease number (which lands in
  // iLeaseNum at the top level when SiteLink assigns one).
  const ledgerId = rental.iLedgerID ?? rentalRT.Ret_Code;
  const leaseNumber = rental.iLeaseNum ?? null;

  // 5. eSign — fetch a SiteLink-hosted URL the customer navigates to in
  //    order to sign every move-in form. SiteLink redirects them to
  //    `sReturnUrl` once they finish. Failure is non-fatal: the rental
  //    is already committed, so we surface a warning and let the user
  //    proceed without signing through the funnel.
  const returnUrl = typeof window !== "undefined"
    ? window.location.origin + "/thank-you"
    : "";
  let signingUrl: string | null = null;
  let esignError: string | null = null;
  try {
    const esign = await post<{ RT: Array<{ Ret_Code: number; Ret_Msg?: string | null }>; signing_url?: string | null }>(
      "SiteLinkeSignCreateLeaseURL_v3",
      {
        sLocationCode,
        iTenantID: tenantId,
        iLedgerID: ledgerId,
        sReturnUrl: returnUrl,
        iIncludeAllMoveInForms: true,
        sFormIdsCommaDelimited: "",
      },
      true,
    );
    const esignRT = esign.RT?.[0];
    if (esign.signing_url && esignRT && esignRT.Ret_Code > 0) {
      signingUrl = esign.signing_url;
    } else {
      esignError = esignRT?.Ret_Msg ?? "Could not retrieve the lease-signing URL.";
    }
  } catch (e) {
    esignError = (e as Error).message;
  }
  return { leaseNumber, ledgerId, tenantId, accessCode, signingUrl, esignError };
}

export default function RentPage() {
  const params = useSearchParams();
  const unitId = params.get("unitId") ?? "";
  const sLocationCode = params.get("sLocationCode") ?? "";
  const [unit, setUnit] = useState<UnitDetail | null>(null);
  const [unitError, setUnitError] = useState<string | null>(null);
  const [form, setForm] = useState<RentForm>(EMPTY_FORM);
  const [insuranceCoverageId, setInsuranceCoverageId] = useState<number>(0);
  const [billingSameAsHome, setBillingSameAsHome] = useState<boolean>(true);
  const [enableAutoPay, setEnableAutoPay] = useState<boolean>(true);
  const [smsOptIn, setSmsOptIn] = useState<boolean>(false);
  const [agreementAccepted, setAgreementAccepted] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [leaseNumber, setLeaseNumber] = useState<number | null>(null);
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
          // bExcludeFromInsurance lives on the unit type and SiteLink
          // inlines it here. If the unit's type is excluded we hide
          // the picker and pin coverage to 0 — matches the PHP
          // reference's getInsuranceOptions short-circuit and avoids
          // MoveInWithDiscount_v5 rejections on non-insurable units.
          excludeFromInsurance: u.bExcludeFromInsurance === true,
          // iInsuranceRequired is the mirror gate — SiteLink mandates
          // insurance for this unit's type. We hide the "Waive"
          // option and force a coverage pick before submit. Comes
          // back as an int (1 = required), not a bool, hence the
          // explicit === 1 comparison.
          insuranceRequired: Number(u.iInsuranceRequired ?? 0) === 1,
        });
      })
      .catch((e) => {
        if (!cancelled) setUnitError(String(e?.message ?? e));
      });
    return () => { cancelled = true; };
  }, [unitId, sLocationCode]);

  function update<K extends keyof RentForm>(field: K, value: RentForm[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const required: Array<[keyof RentForm, string]> = [
      ["firstName", "First name"], ["lastName", "Last name"],
      ["dob", "Date of birth"], ["email", "Email"], ["phone", "Phone"],
      ["addressLine1", "Street address"], ["city", "City"],
      ["state", "State"], ["zip", "ZIP"], ["country", "Country"],
      ["driversLicenseNumber", "Driver's license number"],
      ["driversLicenseState", "Driver's license state"],
      ["moveInDate", "Move-in date"],
      ["tenantPassword", "Account password"],
      ["ccHolderName", "Cardholder name"],
      ["ccNumber", "Card number"],
      ["ccExpireMonth", "Card expiry month"],
      ["ccExpireYear", "Card expiry year"],
      ["ccCvv", "Card CVV"],
      ["agreementSignature", "Signature"],
    ];
    for (const [f, label] of required) {
      if (!form[f].trim()) { setError(label + " is required"); return; }
    }
    if (!billingSameAsHome) {
      const billingRequired: Array<[keyof RentForm, string]> = [
        ["billingAddressLine1", "Billing street address"],
        ["billingCity", "Billing city"],
        ["billingState", "Billing state"],
        ["billingZip", "Billing ZIP"],
        ["billingCountry", "Billing country"],
      ];
      for (const [f, label] of billingRequired) {
        if (!form[f].trim()) { setError(label + " is required"); return; }
      }
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) {
      setError("Email is invalid"); return;
    }
    if (!/^\d{2,4}$/.test(form.ccCvv)) {
      setError("CVV must be 3 or 4 digits"); return;
    }
    if (detectCcType(form.ccNumber) === 0) {
      setError("Card number doesn't match a supported card type"); return;
    }
    if (!agreementAccepted) {
      setError("You must accept the rental agreement to continue"); return;
    }
    if (form.tenantPassword.length < 8) {
      setError("Account password must be at least 8 characters"); return;
    }
    // Block submit when the unit mandates insurance and the user
    // somehow ended up at coverage=0 (waived). The picker hides the
    // waive option in this case, but a DevTools/back-button race
    // could still get us here.
    if (unit?.insuranceRequired && insuranceCoverageId <= 0) {
      setError("This unit requires insurance coverage. Please pick a coverage option."); return;
    }

    setSubmitting(true);
    void submitRental({
      sLocationCode,
      unitId,
      form,
      insuranceCoverageId,
      enableAutoPay,
      billingSameAsHome,
    })
      .then((result) => {
        setLeaseNumber(result.leaseNumber);
        // Stash rental details so /thank-you can render them after the
        // eSign redirect lands back here. We can't pass them as query
        // params on the return URL — SiteLink returns the user via a
        // bare redirect with no extras.
        try {
          sessionStorage.setItem("rentalResult", JSON.stringify({
            leaseNumber: result.leaseNumber,
            ledgerId: result.ledgerId,
            accessCode: result.accessCode,
            unitName: unit?.name ?? null,
          }));
        } catch {
          // private-mode etc. — non-fatal, /thank-you has a fallback.
        }
        if (result.signingUrl) {
          // Hand off to SiteLink to sign every move-in form. SiteLink
          // will redirect to sReturnUrl (= /thank-you) when done.
          window.location.assign(result.signingUrl);
          return;
        }
        // eSign failed — surface a soft warning but still mark the
        // rental as submitted; the lease is already created and the
        // operator can chase signatures out of band.
        if (result.esignError) setError("Rental complete, but we couldn't fetch your lease-signing link: " + result.esignError);
        setSubmitted(true);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSubmitting(false));
  }

  if (submitted) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="text-3xl font-bold mb-4" data-role="heading">You&apos;re moved in!</h1>
        <p data-role="text">
          Your rental of {unit?.name ? "unit " + unit.name : "the unit"} is confirmed.
          Your payment was charged and your lease is active.
        </p>
        {leaseNumber != null && (
          <p className="mt-3 text-sm" data-role="text-2">
            Lease number: <span className="font-mono">{leaseNumber}</span>
          </p>
        )}
        <p className="mt-4 text-sm" data-role="text-3">
          Watch your email for the gate access code and lease document.
        </p>
      </main>
    );
  }

  const ccTypeId = detectCcType(form.ccNumber);
  const ccTypeName = { 5: "Visa", 6: "Mastercard", 7: "Amex", 8: "Discover" }[ccTypeId] ?? null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold mb-2" data-role="heading-2">Rent this unit</h1>

      {unitError && <p className="text-sm mb-6" role="alert" data-role="text-4">Couldn&apos;t load unit details: {unitError}. You can still fill out the form below.</p>}

      {unit && (
        <section className="rounded-md border p-4 mb-8">
          <p className="text-sm uppercase tracking-wider mb-1" data-role="text-5">Unit</p>
          <p className="font-mono text-lg font-bold" data-role="subheading">
            {unit.name ?? unit.id}
            {unit.width != null && unit.length != null ? " · " + unit.width + "×" + unit.length : ""}
            {unit.area != null ? " (" + unit.area + " sq ft)" : ""}
          </p>
          {unit.type && <p className="text-sm">{unit.type}</p>}
          {unit.rate != null && <p className="text-sm mt-2 font-mono">{"$" + unit.rate.toFixed(2) + "/mo"}</p>}
        </section>
      )}

      {process.env.NEXT_PUBLIC_DEV_AUTOFILL === "true" && (
        <button
          type="button"
          onClick={() => {
            setForm(devSampleRentForm());
            setAgreementAccepted(true);
            setBillingSameAsHome(true);
          }}
          className="mb-4 self-start rounded-md border border-dashed px-3 py-1 text-xs opacity-75 hover:opacity-100" data-role="text-6"
        >
          Fill test data (dev only)
        </button>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-6" noValidate>
        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Your information</legend>
          <Row>
            <Field label="First name" value={form.firstName} onChange={(v) => update("firstName", v)} required />
            <Field label="Last name" value={form.lastName} onChange={(v) => update("lastName", v)} required />
          </Row>
          <Row>
            <Field label="Date of birth" type="date" value={form.dob} onChange={(v) => update("dob", v)} required />
            <Field label="Move-in date" type="date" value={form.moveInDate} onChange={(v) => update("moveInDate", v)} required />
          </Row>
          <Row>
            <Field label="Email" type="email" value={form.email} onChange={(v) => update("email", v)} required />
            <Field label="Phone" type="tel" value={form.phone} onChange={(v) => update("phone", v)} required />
          </Row>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Address</legend>
          <Field label="Street address" value={form.addressLine1} onChange={(v) => update("addressLine1", v)} required />
          <Field label="Apt / Suite (optional)" value={form.addressLine2} onChange={(v) => update("addressLine2", v)} />
          <Row>
            <Field label="City" value={form.city} onChange={(v) => update("city", v)} required />
            <Field label="State" value={form.state} onChange={(v) => update("state", v)} required />
            <Field label="ZIP" value={form.zip} onChange={(v) => update("zip", v)} required />
          </Row>
          <Field label="Country" value={form.country} onChange={(v) => update("country", v)} required />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Identification</legend>
          <Row>
            <Field label="Driver's license number" value={form.driversLicenseNumber} onChange={(v) => update("driversLicenseNumber", v)} required />
            <Field label="Issuing state" value={form.driversLicenseState} onChange={(v) => update("driversLicenseState", v)} required />
          </Row>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Insurance</legend>
          <SitelinkInsuranceSelect
            sLocationCode={sLocationCode}
            value={insuranceCoverageId}
            onChange={setInsuranceCoverageId}
            excluded={unit?.excludeFromInsurance ?? false}
            required={unit?.insuranceRequired ?? false}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Payment</legend>
          <Field label="Cardholder name (full name)" value={form.ccHolderName} onChange={(v) => update("ccHolderName", v)} required />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium" data-role="text-7">
              Card number<span aria-hidden="true" data-role="text-8"> *</span>
              {ccTypeName && <span className="text-xs opacity-70 ml-2" data-role="text-9">{ccTypeName} detected</span>}
            </span>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="cc-number"
              value={form.ccNumber}
              onChange={(e) => update("ccNumber", e.target.value)}
              required
              className="rounded-md border px-3 py-2 bg-background font-mono"
            />
          </div>
          <Row>
            <Field label="Expiry month (MM)" inputMode="numeric" value={form.ccExpireMonth} onChange={(v) => update("ccExpireMonth", v.padStart(2, "0").slice(0, 2))} required />
            <Field label="Expiry year (YY)" inputMode="numeric" value={form.ccExpireYear} onChange={(v) => update("ccExpireYear", v.slice(0, 2))} required />
            <Field label="CVV" inputMode="numeric" value={form.ccCvv} onChange={(v) => update("ccCvv", v.slice(0, 4))} required />
          </Row>
          <label className="flex items-center gap-2 text-sm mt-1">
            <input
              type="checkbox"
              checked={enableAutoPay}
              onChange={(e) => setEnableAutoPay(e.target.checked)}
            />
            <span data-role="text-10">Enable autopay (recommended)</span>
          </label>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Billing address</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={billingSameAsHome}
              onChange={(e) => setBillingSameAsHome(e.target.checked)}
            />
            <span data-role="text-11">Same as my home address above</span>
          </label>
          {!billingSameAsHome && (
            <>
              <Field label="Street address" value={form.billingAddressLine1} onChange={(v) => update("billingAddressLine1", v)} required />
              <Field label="Apt / Suite (optional)" value={form.billingAddressLine2} onChange={(v) => update("billingAddressLine2", v)} />
              <Row>
                <Field label="City" value={form.billingCity} onChange={(v) => update("billingCity", v)} required />
                <Field label="State" value={form.billingState} onChange={(v) => update("billingState", v)} required />
                <Field label="ZIP" value={form.billingZip} onChange={(v) => update("billingZip", v)} required />
              </Row>
              <Field label="Country" value={form.billingCountry} onChange={(v) => update("billingCountry", v)} required />
            </>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Account &amp; preferences</legend>
          <Field
            label="Account password (for your tenant portal)"
            type="password"
            value={form.tenantPassword}
            onChange={(v) => update("tenantPassword", v)}
            required
            hint="At least 8 characters. Used to log into your tenant portal after move-in."
          />
          <Field
            label="Promotion code (optional)"
            value={form.promotionCode}
            onChange={(v) => update("promotionCode", v)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={smsOptIn}
              onChange={(e) => setSmsOptIn(e.target.checked)}
            />
            <span data-role="text-12">Send me SMS reminders about my account (optional)</span>
          </label>
        </fieldset>

        <SitelinkOrderSummary
          sLocationCode={sLocationCode}
          unitId={unitId}
          moveInDate={form.moveInDate}
          insuranceCoverageId={insuranceCoverageId}
        />

        <fieldset className="flex flex-col gap-3">
          <legend className="text-sm font-semibold uppercase tracking-wider mb-1">Rental agreement</legend>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={agreementAccepted}
              onChange={(e) => setAgreementAccepted(e.target.checked)}
              className="mt-1"
            />
            <span data-role="text-13">
              I have read and agree to the rental agreement, including the lien policies
              and auto-pay terms (if enabled).<span aria-hidden="true" data-role="text-14"> *</span>
            </span>
          </label>
          <Field
            label="Type your full name to sign"
            value={form.agreementSignature}
            onChange={(v) => update("agreementSignature", v)}
            required
            hint="Your typed name serves as your legal signature on the rental agreement."
          />
        </fieldset>

        {error && <p className="text-sm" role="alert">{error}</p>}

        <button type="submit" disabled={submitting} className="self-start rounded-md px-6 py-3 font-bold disabled:opacity-50 border">
          {submitting ? "Submitting…" : "Submit rental request"}
        </button>
      </form>
    </main>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">{children}</div>;
}

interface FieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: "text" | "numeric" | "tel" | "email" | "url" | "search" | "decimal" | "none";
  required?: boolean;
  hint?: string;
}

function Field({ label, value, onChange, type = "text", inputMode, required = false, hint }: FieldProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">
        {label}{required ? <span aria-hidden="true" data-role="text-15"> *</span> : null}
      </span>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="rounded-md border px-3 py-2 bg-background"
      />
      {hint ? <span className="text-xs opacity-70">{hint}</span> : null}
    </label>
  );
}
