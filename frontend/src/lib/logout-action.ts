"use server";
import { redirect } from "next/navigation";
import { clearTokens } from "@/lib/portal/server";

export async function logout() {
  await clearTokens();
  redirect("/login");
}
