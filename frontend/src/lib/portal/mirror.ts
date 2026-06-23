import { prisma } from "@/lib/db";

/**
 * Bridge: mirror an authenticated Django user into the local Prisma `User` table
 * so the legacy Builds module (still on Prisma, FK'd by user id) keeps working
 * under one identity. Matched by email. Removed once Builds moves to Django.
 */
export async function mirrorDjangoUser(djangoUser: Record<string, unknown>) {
  const email = String(djangoUser.email ?? "").toLowerCase().trim();
  if (!email) return null;

  const fullName = String(djangoUser.full_name ?? "").trim();
  const username = String(djangoUser.username ?? "").trim();
  const name = fullName || username || email;
  const djangoRole = String(djangoUser.role ?? "employee");
  const role: "ADMIN" | "MEMBER" =
    djangoUser.is_superuser || djangoRole === "superuser" || djangoRole === "admin"
      ? "ADMIN"
      : "MEMBER";
  const title = String(djangoUser.job_title ?? "") || null;
  const active = djangoUser.is_active !== false;

  return prisma.user.upsert({
    where: { email },
    create: { name, email, role, title, active },
    update: { name, role, title, active },
    select: { id: true, name: true, email: true, image: true, role: true },
  });
}
