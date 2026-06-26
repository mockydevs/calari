"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Route-level error boundary for a build. Replaces the bare Next "server error"
 * page with a graceful in-app message + retry, so a transient SSR/backend hiccup
 * (e.g. during a deploy) never blanks the screen.
 */
export default function BuildError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Build detail failed to render:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center py-24 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200">
        <AlertTriangle className="h-6 w-6" />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">This build couldn’t load</h2>
      <p className="mt-1.5 text-sm text-slate-500">
        A temporary error occurred — this is usually transient (for example during a deploy). Try again in a moment.
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-5 inline-flex items-center gap-2 rounded-md bg-pink-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-pink-700"
      >
        <RotateCw className="h-4 w-4" /> Try again
      </button>
    </div>
  );
}
