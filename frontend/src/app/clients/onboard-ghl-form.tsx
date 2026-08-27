"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/portal/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function OnboardGhlForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form autoComplete="off" className="space-y-4 rounded-lg border border-slate-200 bg-white p-5" onSubmit={async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      setBusy(true); setError("");
      try {
        const result = await api.post<{ client_id: number }>("projects/clients/onboard-ghl", {
          location_id: data.get("location_id"), token: data.get("token"),
        });
        form.reset();
        router.push(`/clients/${result.client_id}/ghl`);
        router.refresh();
      } catch (err) { setError(err instanceof Error ? err.message : "Could not connect to GHL."); }
      finally { setBusy(false); }
    }}>
      <h2 className="font-semibold text-slate-950">Add client from GoHighLevel</h2>
      <p className="text-sm text-slate-600">Verify the location and automatically fill the business name, email, phone and available business details. No records in GHL are changed.</p>
      <div className="space-y-1.5"><Label htmlFor="onboard-location">Location ID</Label><Input id="onboard-location" name="location_id" required pattern="[A-Za-z0-9_-]{1,120}" maxLength={120} disabled={busy} /></div>
      <div className="space-y-1.5"><Label htmlFor="onboard-token">Private integration token</Label><Input id="onboard-token" name="token" type="password" autoComplete="new-password" required maxLength={4096} disabled={busy} /></div>
      <Button type="submit" disabled={busy} className="w-full">{busy ? "Checking GHL…" : "Connect and add client"}</Button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </form>
  );
}
