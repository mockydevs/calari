"use client";
import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Calendar,
  ChevronRight,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Search,
  Settings,
  Sun,
  Zap,
} from "lucide-react";
import { cn, initials } from "@/lib/portal/format";
import { isAdminRole, isSuperuser, usePortalUser } from "./user-context";
import { useTheme } from "./theme";

const NAV = [
  { key: "dashboard", href: "/staff", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { key: "projects", href: "/staff/projects", label: "Projects", icon: FolderKanban },
];

function navActive(pathname: string, href: string, exact?: boolean) {
  return exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");
}

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = usePortalUser();
  const { theme, toggle } = useTheme();
  const [drawer, setDrawer] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => setDrawer(false), [pathname]);

  async function logout() {
    try {
      await fetch("/api/portal/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    router.push("/staff/login");
  }

  const admin = isAdminRole(user);
  const superuser = isSuperuser(user);
  const crumb = pathname.split("/").filter(Boolean)[1];
  const title = crumb ? crumb.charAt(0).toUpperCase() + crumb.slice(1) : "Dashboard";

  return (
    <>
      {/* Sidebar */}
      <aside className={cn("portal-sidebar", drawer && "show")}>
        <div className="flex items-center gap-2.5 border-b px-4 py-3.5" style={{ borderColor: "var(--border)" }}>
          <span className="portal-logo-icon">
            <Zap className="h-4 w-4" />
          </span>
          <div className="leading-tight">
            <div className="text-[1.1rem] font-bold">Calari</div>
            <div className="portal-text-muted -mt-1 text-[0.6rem]">Staff Portal</div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 border-b px-4 py-2.5" style={{ borderColor: "var(--border)" }}>
          <span className="portal-avatar" style={{ width: 30, height: 30, fontSize: 11 }}>
            {initials(user?.full_name || user?.username)}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[0.78rem] font-semibold">{user?.full_name || user?.username || "User"}</div>
            <div className="portal-text-muted text-[0.65rem] capitalize">{user?.role || "—"}</div>
          </div>
        </div>

        <nav className="flex-1 py-2">
          <div className="portal-section-label">Menu</div>
          {NAV.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              className={cn("portal-nav-item", navActive(pathname, item.href, item.exact) && "active")}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="border-t py-2" style={{ borderColor: "var(--border)" }}>
          {admin && (
            <>
              <div className="portal-section-label">Admin</div>
              <Link
                href="/staff/admin"
                className={cn("portal-nav-item", navActive(pathname, "/staff/admin") && "active")}
              >
                <Gauge className="h-4 w-4" /> Admin Dashboard
              </Link>
            </>
          )}
          {superuser && (
            <Link
              href="/staff/settings"
              className={cn("portal-nav-item", navActive(pathname, "/staff/settings") && "active")}
            >
              <Settings className="h-4 w-4" /> Settings
            </Link>
          )}
          <button onClick={logout} className="portal-nav-item w-full" style={{ color: "var(--accent-red)" }}>
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {drawer && (
        <div
          className="fixed inset-0 z-[1039] bg-black/55 lg:hidden"
          onClick={() => setDrawer(false)}
        />
      )}

      {/* Topnav */}
      <header className="portal-topnav">
        <button className="portal-topnav-btn lg:hidden" onClick={() => setDrawer((d) => !d)} aria-label="Menu">
          <Menu className="h-4 w-4" />
        </button>

        <nav className="portal-text-muted hidden items-center gap-1.5 text-[0.72rem] md:flex">
          <span>Dashboard</span>
          <ChevronRight className="h-3 w-3" />
          <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </span>
        </nav>

        <div className="relative ml-2 hidden max-w-[300px] flex-1 sm:block">
          <Search className="portal-text-muted pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <input className="portal-search-input" placeholder="Search…" aria-label="Search" />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button className="portal-topnav-btn" onClick={toggle} title="Toggle theme">
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
          <button className="portal-topnav-btn" title="Notifications">
            <Bell className="h-4 w-4" />
          </button>
          <button className="portal-topnav-btn hidden sm:flex" title="Calendar">
            <Calendar className="h-4 w-4" />
          </button>

          <div className="relative">
            <button
              className="portal-topnav-btn flex items-center gap-2"
              style={{ width: "auto", padding: "0.28rem 0.6rem" }}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span className="portal-avatar" style={{ width: 24, height: 24, fontSize: 10 }}>
                {initials(user?.full_name || user?.username)}
              </span>
              <span className="hidden text-[0.75rem] font-semibold sm:inline" style={{ color: "var(--text-primary)" }}>
                {user?.full_name || user?.username || "User"}
              </span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-[1051]" onClick={() => setMenuOpen(false)} />
                <div className="portal-dropdown absolute right-0 z-[1052] mt-1">
                  {superuser && (
                    <Link href="/staff/settings" className="portal-dropdown-item" onClick={() => setMenuOpen(false)}>
                      <Settings className="h-3.5 w-3.5" /> Settings
                    </Link>
                  )}
                  <button className="portal-dropdown-item" style={{ color: "var(--accent-red)" }} onClick={logout}>
                    <LogOut className="h-3.5 w-3.5" /> Sign Out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="portal-main">{children}</main>
    </>
  );
}
