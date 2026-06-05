import Link from "next/link";
import { Clock } from "lucide-react";

export default function SignupPendingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#ecfeff_0%,#f8fafc_52%,#eef2f7_100%)] px-6 py-12">
      <div className="w-full max-w-md rounded-lg border border-white/80 bg-white/90 p-8 text-center shadow-xl shadow-slate-900/10 backdrop-blur">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
          <Clock className="h-5 w-5" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight text-slate-950">
          Signup submitted
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Your self-signup account is waiting for admin approval. You will be able to sign in after an admin activates your access.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-md bg-cyan-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-cyan-800"
        >
          Back to sign in
        </Link>
      </div>
    </main>
  );
}
