"use server";

import { revalidatePath } from "next/cache";
import type { AIProvider } from "@prisma/client";
import { requireAdmin } from "@/lib/auth-helpers";
import { encryptApiKey, previewApiKey } from "@/lib/api-keys";
import { prisma } from "@/lib/db";

const PROVIDERS = new Set<AIProvider>([
  "OPENAI",
  "ANTHROPIC",
  "GOOGLE",
  "GROQ",
  "MISTRAL",
  "OPENROUTER",
  "OTHER",
]);

function parseProvider(value: FormDataEntryValue | null): AIProvider {
  const provider = String(value ?? "") as AIProvider;
  if (!PROVIDERS.has(provider)) throw new Error("Invalid AI provider");
  return provider;
}

export async function createApiKey(formData: FormData) {
  const admin = await requireAdmin();
  const provider = parseProvider(formData.get("provider"));
  const label = String(formData.get("label") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const makeActive = formData.get("active") === "on";

  if (!label) throw new Error("Label is required");
  if (!apiKey) throw new Error("API key is required");

  await prisma.$transaction(async (tx) => {
    if (makeActive) {
      await tx.aiApiKey.updateMany({
        where: { provider, active: true },
        data: { active: false, updatedById: admin.id },
      });
    }

    await tx.aiApiKey.create({
      data: {
        provider,
        label,
        encryptedKey: encryptApiKey(apiKey),
        keyPreview: previewApiKey(apiKey),
        active: makeActive,
        createdById: admin.id,
        updatedById: admin.id,
      },
    });
  });

  revalidatePath("/settings/ai");
}

export async function activateApiKey(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("API key id is required");

  const key = await prisma.aiApiKey.findUnique({ where: { id } });
  if (!key) throw new Error("API key not found");

  await prisma.$transaction([
    prisma.aiApiKey.updateMany({
      where: { provider: key.provider, active: true },
      data: { active: false, updatedById: admin.id },
    }),
    prisma.aiApiKey.update({
      where: { id },
      data: { active: true, updatedById: admin.id },
    }),
  ]);

  revalidatePath("/settings/ai");
}

export async function deleteApiKey(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) throw new Error("API key id is required");

  await prisma.aiApiKey.delete({ where: { id } });
  revalidatePath("/settings/ai");
}

