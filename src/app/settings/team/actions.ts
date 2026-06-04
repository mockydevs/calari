"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-helpers";

export async function createMember(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "MEMBER") === "ADMIN" ? "ADMIN" : "MEMBER";
  if (!name || !email || password.length < 6) throw new Error("Name, email and a 6+ char password are required");
  await prisma.user.create({ data: { name, email, role, passwordHash: await bcrypt.hash(password, 10) } });
  revalidatePath("/settings/team");
}
