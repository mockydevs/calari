import crypto from "node:crypto";
import type { AIProvider } from "@prisma/client";
import { prisma } from "@/lib/db";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Claude / Anthropic",
  GOOGLE: "Google AI",
  GROQ: "Groq",
  MISTRAL: "Mistral",
  OPENROUTER: "OpenRouter",
  OTHER: "Other",
};

function getEncryptionSecret() {
  return process.env.API_KEY_ENCRYPTION_SECRET ?? process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
}

function getEncryptionKey() {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error("API_KEY_ENCRYPTION_SECRET or AUTH_SECRET is required to store provider API keys");
  }
  return crypto.scryptSync(secret, "calari-ai-provider-keys", KEY_LENGTH);
}

export function encryptApiKey(apiKey: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(apiKey, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptApiKey(encryptedValue: string) {
  const [iv, tag, encrypted] = encryptedValue.split(":");
  if (!iv || !tag || !encrypted) throw new Error("Stored API key is malformed");

  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function previewApiKey(apiKey: string) {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 8) return "********";
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export async function getActiveProviderApiKey(provider: AIProvider) {
  try {
    const record = await prisma.aiApiKey.findFirst({
      where: { provider, active: true },
      orderBy: { updatedAt: "desc" },
    });
    if (record) return decryptApiKey(record.encryptedKey);
  } catch {
    // Allows older databases to keep using env keys until the schema is pushed.
  }

  if (provider === "OPENAI" && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (provider === "ANTHROPIC" && process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  return null;
}

