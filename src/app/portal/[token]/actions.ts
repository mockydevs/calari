"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { notify } from "@/lib/notify";

export async function submitPortalFeedback(token: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || null;
  const message = String(formData.get("message") ?? "").trim();
  if (!message) throw new Error("Feedback message is required");

  const build = await prisma.build.findFirst({
    where: { clientPortalToken: token, clientPortalEnabled: true },
  });
  if (!build) throw new Error("Portal not found");

  await prisma.clientPortalFeedback.create({
    data: { buildId: build.id, name, message },
  });
  await notify({
    userId: build.creatorId,
    type: "CHANGE_REQUEST",
    message: `Client portal feedback: ${build.title}`,
    link: `/builds/${build.id}`,
  });
  revalidatePath(`/portal/${token}`);
}

