"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { hashInviteToken } from "@/lib/team-invites";

export async function completeSignup(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!token) throw new Error("Invite token is missing");
  if (!name) throw new Error("Name is required");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if (password !== confirmPassword) throw new Error("Passwords do not match");

  const invite = await prisma.teamInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new Error("This signup link is invalid or expired");
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.$transaction(async (tx) => {
    await tx.user.upsert({
      where: { email: invite.email },
      update: {
        name,
        role: invite.role,
        passwordHash,
        active: true,
      },
      create: {
        name,
        email: invite.email,
        role: invite.role,
        passwordHash,
        active: true,
      },
    });
    await tx.teamInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });
  });

  redirect("/login");
}
