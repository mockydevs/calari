"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth-helpers";
import { clientSchema } from "@/lib/validations";
import { serverApi } from "@/lib/portal/server";

export async function createClient(formData: FormData) {
  await requireAdmin();
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    company: formData.get("company") || undefined,
    email: formData.get("email") || "",
    notes: formData.get("notes") || undefined,
  });
  if (!parsed.success) throw new Error(parsed.error.errors[0]?.message ?? "Invalid input");

  // Consumes the Django backend (projects.Clients) instead of Prisma.
  await serverApi.post("projects/clients", {
    name: parsed.data.name,
    company_name: parsed.data.company ?? "",
    email: parsed.data.email || "",
    phone_number: "",
    is_active: true,
  });

  revalidatePath("/clients");
  redirect("/clients");
}
