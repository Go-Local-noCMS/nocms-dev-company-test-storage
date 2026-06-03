"use client";

import { useEffect, useState } from "react";

interface RentalResult {
  leaseNumber: number | null;
  ledgerId: number | null;
  accessCode: string;
  unitName: string | null;
}

export default function ThankYouPage() {
  const [result, setResult] = useState<RentalResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("rentalResult");
      if (raw) setResult(JSON.parse(raw) as RentalResult);
    } catch {
      // ignore — fall through to the generic message
    }
    setLoaded(true);
  }, []);

  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold mb-4" data-role="heading">You&apos;re moved in!</h1>
      <p data-role="text">
        Thanks for signing your lease. {result?.unitName
          ? "Your rental of unit " + result.unitName + " is confirmed."
          : "Your rental is confirmed."}{" "}
        Your payment was charged and your lease is active.
      </p>
      {loaded && result ? (
        <dl className="mt-6 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
          {result.leaseNumber != null ? (
            <>
              <dt className="font-semibold" data-role="text-2">Lease #</dt>
              <dd className="font-mono">{result.leaseNumber}</dd>
            </>
          ) : null}
          {result.accessCode ? (
            <>
              <dt className="font-semibold" data-role="text-3">Gate code</dt>
              <dd className="font-mono">{result.accessCode}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      <p className="mt-6 text-sm" data-role="text-4">
        Watch your email for a copy of your signed lease and any
        additional move-in instructions.
      </p>
    </main>
  );
}
