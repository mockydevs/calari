import { redirect } from "next/navigation";
import { getPortalUser } from "@/lib/portal/server";

export interface AppUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MEMBER";
  image: string | null;
}

interface DjangoUser {
  id: number;
  username: string;
  full_name?: string;
  email?: string;
  role?: string;
  is_superuser?: boolean;
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
  };
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
