import Link from "next/link";
import { signOut } from "@/auth";
import { serverApi } from "@/lib/portal/server";
import { Bell, BriefcaseBusiness, KanbanSquare, LogOut, Settings, Users } from "lucide-react";

export async function TopNav({ user }: { user: { id: string; name: string; role: string } }) {
  const unread = await serverApi
    .get<{ id: number }[]>("builds/notifications?read=false")
    .then((a) => (Array.isArray(a) ? a.length : 0))
    .catch(() => 0);
  const isAdmin = user.role === "ADMIN";
  const navItems = [
    { href: "/builds", label: "Builds", icon: BriefcaseBusiness, show: true },
    { href: "/builds/kanban", label: "Board", icon: KanbanSquare, show: true },
    { href: "/clients", label: "Clients", icon: Users, show: isAdmin },
    { href: "/settings/team", label: "Team", icon: Settings, show: isAdmin },
  ];

  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 shadow-sm shadow-slate-900/[0.03] backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/dashboard" className="mr-2 flex items-center gap-2 rounded-md px-1 py-1 font-semibold text-slate-950 transition-colors hover:text-cyan-700">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gradient-to-br from-cyan-500 to-emerald-500 text-xs font-black text-white">CI</span>
            Calari Internal
          </Link>
          {navItems.filter((item) => item.show).map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-between gap-3 lg:justify-end">
          <Link href="/notifications" className="relative rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950" aria-label="Notifications">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {unread}
              </span>
            )}
          </Link>
          <span className="max-w-40 truncate text-sm font-medium text-slate-700">{user.name}</span>
          <form action={async () => { "use server"; await signOut({ redirectTo: "/login" }); }}>
            <button className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950">
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
