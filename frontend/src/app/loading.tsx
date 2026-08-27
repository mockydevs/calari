export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="w-full space-y-6">
      <p className="text-sm text-slate-500">Loading workspace…</p>
      <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
        <div className="h-8 w-64 rounded-lg bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map(i => <div key={i} className="h-28 rounded-xl border border-slate-200 bg-white" />)}
        </div>
        <div className="h-72 rounded-xl border border-slate-200 bg-white" />
      </div>
    </div>
  );
}
