import { redirect } from "next/navigation";
import { getPortalUser } from "@/lib/portal/server";

/** Feature keys an admin can grant to a member (mirror of backend FEATURE_KEYS). */
export type FeatureKey = "a2p" | "clients" | "builds_manage" | "team" | "ai_keys";
export const FEATURE_KEYS: FeatureKey[] = ["a2p", "clients", "builds_manage", "team", "ai_keys"];
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  a2p: "A2P intake",
  clients: "Clients",
  builds_manage: "Builds management",
  team: "Team management",
  ai_keys: "AI keys",
};

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  image: string | null;
  features: FeatureKey[];
}

interface DjangoUser {
  id: number;
  username: string;
  full_name?: string;
  email?: string;
  role?: string;
  is_superuser?: boolean;
  feature_permissions?: string[];
}

export function mapDjangoUser(d: DjangoUser): AppUser {
  const role: "ADMIN" | "MEMBER" =
    d.is_superuser || d.role === "admin" || d.role === "superuser" ? "ADMIN" : "MEMBER";
  return {
    id: String(d.id),
    name: d.full_name || d.username,
    email: d.email || "",
    role,
    image: null,
    features: (d.feature_permissions ?? []).filter((k): k is FeatureKey => (FEATURE_KEYS as string[]).includes(k)),
  };
}

/** Admins implicitly have every feature; members must be granted it. */
export function canFeature(user: AppUser, key: FeatureKey): boolean {
  return user.role === "ADMIN" || user.features.includes(key);
}

/** The current app user (Django identity) or null. */
export async function getAppUser(): Promise<AppUser | null> {
  const d = (await getPortalUser()) as DjangoUser | null;
  return d ? mapDjangoUser(d) : null;
}

export async function requireUser(): Promise<AppUser> {
  const user = await getAppUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/dashboard");
  return user;
}

/** Require a specific feature grant (admins always pass). Redirects members
 * without the grant back to the dashboard. */
export async function requireFeature(key: FeatureKey): Promise<AppUser> {
  const user = await requireUser();
  if (!canFeature(user, key)) redirect("/dashboard");
  return user;
}
