"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

export async function selfSignup(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!name || !email) throw new Error("Name and email are required");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if (password !== confirmPassword) throw new Error("Passwords do not match");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing?.active) throw new Error("An active account already exists for this email");

  await prisma.user.upsert({
    where: { email },
    update: {
      name,
      role: "MEMBER",
      passwordHash: await bcrypt.hash(password, 10),
      active: false,
    },
    create: {
      name,
      email,
      role: "MEMBER",
      passwordHash: await bcrypt.hash(password, 10),
      active: false,
    },
  });

  redirect("/signup/pending");
}

