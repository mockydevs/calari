"use client";
import * as React from "react";
import { api } from "@/lib/portal/api";
import type { User } from "@/lib/portal/types";

interface PortalUserState {
  user: User | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const UserCtx = React.createContext<PortalUserState>({
  user: null,
  loading: true,
  refresh: async () => {},
});

export function usePortalUser() {
  return React.useContext(UserCtx);
}

/** Role helpers shared across the portal. */
export function isAdminRole(u: User | null): boolean {
  return !!u && (u.is_superuser || u.role === "admin" || u.effective_role === "admin" || u.effective_role === "superuser");
}
export function isSuperuser(u: User | null): boolean {
  return !!u && (u.is_superuser || u.role === "superuser" || u.effective_role === "superuser");
}

export function PortalUserProvider({
  initialUser,
  children,
}: {
  initialUser: User | null;
  children: React.ReactNode;
}) {
  const [user, setUser] = React.useState<User | null>(initialUser);
  const [loading, setLoading] = React.useState(!initialUser);

  const refresh = React.useCallback(async () => {
    try {
      const u = await api.get<User>("auth/me");
      setUser(u);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!initialUser) void refresh();
  }, [initialUser, refresh]);

  return <UserCtx.Provider value={{ user, loading, refresh }}>{children}</UserCtx.Provider>;
}
