"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, CircleHelp } from "lucide-react";

const labels: Record<string, string> = { dashboard: "Overview", chat: "GHL Chat", tasks: "Tasks", builds: "GHL delivery", projects: "Projects", clients: "Clients", settings: "Settings", library: "Build library", notifications: "Notifications", a2p: "A2P intake" };
export function WorkspaceHeader() {
  const pathname = usePathname();
  const area = pathname.split('/')[1];
  return <header className="sticky top-0 z-10 hidden h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-8 backdrop-blur lg:flex">
    <div className="flex items-center gap-3 text-xs"><span className="font-semibold text-slate-400">Calari</span><ChevronRight className="h-3.5 w-3.5 text-slate-300" /><span className="font-medium text-slate-700">{labels[area] || 'Workspace'}</span></div>
    <Link href="/library" className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-900"><CircleHelp className="h-4 w-4" /> Resources & playbooks</Link>
  </header>;
}
