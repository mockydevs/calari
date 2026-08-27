import Link from "next/link";
import { requireAdmin } from "@/lib/auth-helpers";
import { FathomWorkspace } from "./workspace";

export default async function FathomPage() {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/settings/connections" className="text-sm text-slate-500 hover:text-slate-900">Integrations</Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Fathom meetings</h1>
        <p className="mt-2 text-sm text-slate-600">Bring meeting notes into client delivery automatically. Review uncertain matches here.</p>
      </div>
      <FathomWorkspace />
    </div>
  );
}
