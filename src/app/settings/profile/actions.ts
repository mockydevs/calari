"use server";

import bcrypt from "bcryptjs";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { getPublicUrl, uploadObject } from "@/lib/s3";
import { nanoid } from "@/lib/utils";

const MAX_AVATAR_SIZE = 3 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function storageReady() {
  const required = ["AWS_S3_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  return missing.length === 0 ? null : `Storage is not configured: missing ${missing.join(", ")}.`;
}

function cleanOptional(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}

export async function updateProfile(formData: FormData) {
  const sessionUser = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  const title = cleanOptional(formData.get("title"));
  const phone = cleanOptional(formData.get("phone"));
  const imageUrl = cleanOptional(formData.get("imageUrl"));
  const removeImage = formData.get("removeImage") === "on";
  const avatar = formData.get("avatar");

  if (!name) throw new Error("Name is required");

  let image = removeImage ? null : imageUrl;
  if (avatar instanceof File && avatar.size > 0) {
    if (!ALLOWED_AVATAR_TYPES.has(avatar.type)) {
      throw new Error("Upload a PNG, JPG, or WEBP profile image");
    }
    if (avatar.size > MAX_AVATAR_SIZE) {
      throw new Error("Profile image must be 3 MB or smaller");
    }
    const configError = storageReady();
    if (configError) throw new Error(configError);

    const ext = avatar.type === "image/png" ? "png" : avatar.type === "image/webp" ? "webp" : "jpg";
    const key = `profiles/${sessionUser.id}/${nanoid()}.${ext}`;
    await uploadObject(key, Buffer.from(await avatar.arrayBuffer()), avatar.type);
    image = getPublicUrl(key);
  }

  await prisma.user.update({
    where: { id: sessionUser.id },
    data: { name, title, phone, image },
  });

  revalidatePath("/settings/profile");
  revalidatePath("/dashboard");
}

export async function updatePassword(formData: FormData) {
  const sessionUser = await requireUser();
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");
  if (newPassword !== confirmPassword) throw new Error("Passwords do not match");

  const user = await prisma.user.findUnique({
    where: { id: sessionUser.id },
    select: { passwordHash: true },
  });
  if (!user?.passwordHash) throw new Error("Password login is not enabled for this account");

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new Error("Current password is incorrect");

  await prisma.user.update({
    where: { id: sessionUser.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 10) },
  });

  revalidatePath("/settings/profile");
}
