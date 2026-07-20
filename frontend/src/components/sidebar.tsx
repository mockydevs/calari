import { logout } from "@/lib/logout-action";
import { NavItem } from "@/components/nav-item";
import { NotificationsNav } from "@/components/notifications-nav";
import type { NavIconName } from "@/components/nav-item";
import { ExternalLink, Globe, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";

const MAIN_SITE_URL = "https://calarisolutions.com";

export function Sidebar({ user }: { user: { id: string; name: string; role: string; image?: string | null; features?: string[] } }) {
  const isAdmin = user.role === "ADMIN";
  const can = (key: string) => isAdmin || (user.features ?? []).includes(key);

  const navItems: { href: string; label: string; iconName: NavIconName; show: boolean }[] = [
    { href: "/dashboard", label: "Dashboard", iconName: "LayoutDashboard", show: true },
    { href: "/tasks", label: "Tasks", iconName: "ListChecks", show: true },
    { href: "/projects", label: "Projects", iconName: "FolderKanban", show: true },
    { href: "/builds", label: "Builds", iconName: "BriefcaseBusiness", show: true },
    { href: "/builds/kanban", label: "Board", iconName: "KanbanSquare", show: true },
    { href: "/library", label: "Build Library", iconName: "BookOpen", show: true },
    { href: "/a2p", label: "A2P intake", iconName: "MessageSquare", show: can("a2p") },
    { href: "/clients", label: "Clients", iconName: "Users", show: can("clients") },
    { href: "/settings/profile", label: "Profile", iconName: "CircleUserRound", show: true },
    { href: "/settings/team", label: "Team", iconName: "Settings", show: can("team") },
    { href: "/settings/ai", label: "AI Keys", iconName: "KeyRound", show: can("ai_keys") },
    { href: "/settings/connections", label: "Integrations", iconName: "Cable", show: can("ai_keys") },
  ];

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside className="flex h-full w-72 flex-col border-r border-white/[0.08] bg-slate-950 text-white shadow-2xl shadow-slate-950/20">
      <div className="flex h-20 shrink-0 flex-col justify-center gap-1.5 border-b border-white/[0.08] px-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="Calari" className="h-7 w-auto self-start" />
        <p className="text-xs text-slate-400">Client delivery command</p>
      </div>

      <nav className="sidebar-scroll flex-1 overflow-y-auto px-3 py-5">
        <p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
          Workspace
        </p>
        <ul className="space-y-0.5">
          {navItems
            .filter((item) => item.show)
            .map((item) => (
              <NavItem
                key={item.href}
                href={item.href}
                label={item.label}
                iconName={item.iconName}
              />
            ))}
        </ul>
      </nav>

      <div className="shrink-0 border-t border-white/[0.08] px-3 pb-4 pt-3">
        <ul className="space-y-0.5">
          <NotificationsNav />
        </ul>

        <a
          href={MAIN_SITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors duration-200 hover:bg-white/[0.06] hover:text-white"
        >
          <Globe className="h-4 w-4 shrink-0" />
          Main site
          <ExternalLink className="ml-auto h-3.5 w-3.5 opacity-50" />
        </a>

        <Link href="/settings/profile" className="mt-3 block rounded-lg border border-white/[0.08] bg-white/[0.04] p-3 transition-colors hover:bg-white/[0.07]">
          <div className="flex items-center gap-3">
            {user.image ? (
              <span
                aria-hidden="true"
                className="h-9 w-9 shrink-0 rounded-full bg-cover bg-center ring-1 ring-pink-300/20"
                style={{ backgroundImage: `url(${user.image})` }}
              />
            ) : (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pink-500/15 text-xs font-semibold text-pink-100 ring-1 ring-pink-300/20">
                {initials}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium leading-tight text-white">{user.name}</p>
              <p className="mt-1 flex items-center gap-1.5 truncate text-xs capitalize leading-tight text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 text-pink-300" />
                {user.role.toLowerCase()} access
              </p>
            </div>
          </div>
        </Link>

        <form action={logout}>
          <button className="group mt-2 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors duration-200 hover:bg-red-500/10 hover:text-red-300">
            <LogOut className="h-4 w-4 shrink-0 transition-colors group-hover:text-red-300" />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
