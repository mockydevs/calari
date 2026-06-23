"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  BriefcaseBusiness,
  CircleUserRound,
  FolderKanban,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  Settings,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP = {
  LayoutDashboard,
  BriefcaseBusiness,
  FolderKanban,
  KanbanSquare,
  KeyRound,
  Users,
  Settings,
  Bell,
  CircleUserRound,
} as const;

export type NavIconName = keyof typeof ICON_MAP;

interface NavItemProps {
  href: string;
  label: string;
  iconName: NavIconName;
  badge?: number;
}

export function NavItem({ href, label, iconName, badge }: NavItemProps) {
  const pathname = usePathname();
  const isActive =
    pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
  const Icon = ICON_MAP[iconName];

  return (
    <li>
      <Link
        href={href}
        className={cn(
          "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
          isActive
            ? "bg-white text-slate-950 shadow-sm shadow-slate-950/10"
            : "text-slate-400 hover:bg-white/[0.06] hover:text-white",
        )}
      >
        <Icon
          className={cn(
            "h-4 w-4 shrink-0 transition-colors",
            isActive ? "text-pink-600" : "text-slate-500 group-hover:text-pink-200",
          )}
        />
        <span className="flex-1 truncate">{label}</span>
        {badge != null && badge > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </Link>
    </li>
  );
}
