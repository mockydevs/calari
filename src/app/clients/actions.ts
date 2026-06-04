"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth-helpers";
import { clientSchema } from "@/lib/validations";

export async function createClient(formData: FormData) {
  await requireAdmin();
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    company: formData.get("company") || undefined,
    email: formData.get("email") || "",
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");
  await prisma.client.create({
    data: {
      name: parsed.data.name,
      company: parsed.data.company,
      email: parsed.data.email || null,
      notes: parsed.data.notes,
    },
  });
  revalidatePath("/clients");
  redirect("/clients");
}
