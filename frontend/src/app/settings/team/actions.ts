"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  createInviteToken,
  hashInviteToken,
  sendTeamInviteEmail,
  signupUrlForToken,
} from "@/lib/team-invites";

function parseRole(value: FormDataEntryValue | null): Role {
  return String(value ?? "MEMBER") === "ADMIN" ? "ADMIN" : "MEMBER";
}

export async function createInvite(formData: FormData) {
  const admin = await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").toLowerCase().trim();
  const role = parseRole(formData.get("role"));
  if (!name || !email) throw new Error("Name and email are required");

  const existingActiveUser = await prisma.user.findFirst({ where: { email, active: true } });
  if (existingActiveUser) throw new Error("An active user already exists for that email");

  const token = createInviteToken();
  const inviteUrl = signupUrlForToken(token);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7);

  await prisma.teamInvite.create({
    data: {
      name,
      email,
      role,
      tokenHash: hashInviteToken(token),
      expiresAt,
      invitedById: admin.id,
    },
  });

  await sendTeamInviteEmail({ email, name, inviteUrl }).catch((err) => {
    console.error("team invite email failed", err);
  });

  revalidatePath("/settings/team");
}

export async function approveUser(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("User id is required");

  await prisma.user.update({ where: { id }, data: { active: true } });
  revalidatePath("/settings/team");
}

export async function deactivateUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("User id is required");
  if (id === admin.id) throw new Error("You cannot deactivate yourself");

  await prisma.user.update({ where: { id }, data: { active: false } });
  revalidatePath("/settings/team");
}

export async function cancelInvite(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("Invite id is required");

  await prisma.teamInvite.delete({ where: { id } });
  revalidatePath("/settings/team");
}

