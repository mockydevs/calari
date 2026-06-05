import { auth } from "@/auth";
import { getPresignedUploadUrl, getPublicUrl } from "@/lib/s3";
import { prisma } from "@/lib/db";
import { logActivity, notify } from "@/lib/notify";
import { isAiReadableDocument } from "@/lib/document-text";
import { nanoid } from "@/lib/utils";
import type { Role } from "@prisma/client";

type UploadBody = {
  key?: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  buildId?: string;
  taskId?: string;
};

type SessionUser = {
  id: string;
  name: string;
  role: Role;
};

function storageReady() {
  const required = ["AWS_S3_BUCKET_NAME", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
  const missing = required.filter((key) => !process.env[key]);
  return missing.length === 0 ? null : `Storage is not configured: missing ${missing.join(", ")}.`;
}

async function resolveUploadTarget(body: UploadBody, user: SessionUser) {
  if (!body.buildId && !body.taskId) return { error: "buildId or taskId required" };

  const task = body.taskId
    ? await prisma.task.findUnique({
        where: { id: body.taskId },
        include: { build: true },
      })
    : null;
  if (body.taskId && !task) return { error: "Task not found" };

  const build = task?.build ?? (body.buildId ? await prisma.build.findUnique({ where: { id: body.buildId } }) : null);
  if (!build) return { error: "Build not found" };
  if (body.buildId && task && task.buildId !== body.buildId) return { error: "Task does not belong to build" };

  const canAccess = user.role === "ADMIN" || build.creatorId === user.id || build.assigneeId === user.id;
  if (!canAccess) return { error: "Unauthorized", status: 403 };

  return { build, task };
}

/**
 * POST /api/upload
 * Body: { filename, contentType, sizeBytes, buildId?, taskId? }
 * Returns: { uploadUrl, publicUrl, key }
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as UploadBody | null;
  if (!body?.filename || !body?.contentType) {
    return Response.json({ error: "filename and contentType required" }, { status: 400 });
  }

  const configError = storageReady();
  if (configError) return Response.json({ error: configError }, { status: 503 });

  const target = await resolveUploadTarget(body, session.user);
  if ("error" in target) return Response.json({ error: target.error }, { status: target.status ?? 400 });

  const ext = body.filename.split(".").pop() ?? "bin";
  const key = `uploads/${nanoid()}.${ext}`;

  const uploadUrl = await getPresignedUploadUrl(key, body.contentType);
  const publicUrl = getPublicUrl(key);

  return Response.json({ uploadUrl, publicUrl, key });
}

/**
 * PUT /api/upload
 * Body: { key, filename, contentType, sizeBytes, buildId?, taskId? }
 * Called after the S3 PUT succeeds and creates the Document row.
 */
export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as UploadBody | null;
  if (!body?.key || !body?.filename) {
    return Response.json({ error: "key and filename required" }, { status: 400 });
  }

  const target = await resolveUploadTarget(body, session.user);
  if ("error" in target) return Response.json({ error: target.error }, { status: target.status ?? 400 });

  const publicUrl = getPublicUrl(body.key);

  const doc = await prisma.document.create({
    data: {
      filename: body.filename,
      url: publicUrl,
      mimeType: body.contentType ?? null,
      sizeBytes: body.sizeBytes ?? null,
      aiReadable: isAiReadableDocument(body.filename, body.contentType),
      buildId: body.taskId ? null : target.build.id,
      taskId: body.taskId ?? null,
      uploaderId: session.user.id,
    },
  });

  await logActivity(target.build.id, session.user.name ?? "Unknown", `uploaded "${body.filename}"`);

  if (target.build.creatorId !== session.user.id) {
    await notify({
      userId: target.build.creatorId,
      type: "DOCUMENT_UPLOADED",
      message: `New file uploaded: ${body.filename}`,
      link: `/builds/${target.build.id}`,
    });
  }
  if (target.build.assigneeId && target.build.assigneeId !== session.user.id && target.build.assigneeId !== target.build.creatorId) {
    await notify({
      userId: target.build.assigneeId,
      type: "DOCUMENT_UPLOADED",
      message: `New file uploaded: ${body.filename}`,
      link: `/builds/${target.build.id}`,
    });
  }

  return Response.json({ doc });
}
