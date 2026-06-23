"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth-helpers";
import { deleteObject, keyFromUrl } from "@/lib/s3";

export async function deleteDocument(documentId: string, buildId: string) {
  const user = await requireUser();
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new Error("Document not found");
  if (doc.uploaderId !== user.id && user.role !== "ADMIN") {
    throw new Error("Not authorised to delete this document");
  }
  // Delete from S3 first
  try {
    await deleteObject(keyFromUrl(doc.url));
  } catch {
    // Continue even if S3 delete fails — at least clean the DB row
  }
  await prisma.document.delete({ where: { id: documentId } });
  revalidatePath(`/builds/${buildId}`);
}
