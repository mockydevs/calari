"use client";
import * as React from "react";
import { Link2 } from "lucide-react";
import { api, ApiError } from "@/lib/portal/api";
import { useToast, Spinner } from "@/components/toast";

/** Kick off the provider OAuth flow: fetch the authorize URL, then full-page navigate. */
export function OAuthConnectButton({ provider, label }: { provider: string; label: string }) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);

  async function connect() {
    setBusy(true);
    try {
      const res = await api.post<{ url: string }>(`onboarding/oauth/${provider}/authorize-url`, {});
      if (res.url) {
        window.location.href = res.url; // leave the SPA → provider consent screen
      } else {
        toast.error("No authorize URL returned.");
        setBusy(false);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : `Could not start ${label} OAuth.`);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={connect}
      disabled={busy}
      className="inline-flex h-8 items-center gap-1.5 rounded-md bg-gradient-to-r from-pink-600 to-fuchsia-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:from-pink-700 hover:to-fuchsia-700 disabled:opacity-60"
    >
      {busy ? <Spinner className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />} Connect
    </button>
  );
}
