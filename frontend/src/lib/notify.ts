import nodemailer from "nodemailer";
import { prisma } from "@/lib/db";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

type NotifyArgs = {
  userId: string;
  type: string;
  message: string;
  link: string;
};

type PreferenceKey =
  | "buildAssigned"
  | "taskUpdated"
  | "followUpNotes"
  | "changeRequests"
  | "readyForReview"
  | "documentUploaded";

function preferenceKeyForType(type: string): PreferenceKey | null {
  if (type === "BUILD_ASSIGNED") return "buildAssigned";
  if (type === "TASK_UPDATED") return "taskUpdated";
  if (type === "MEETING_NOTE_ADDED") return "followUpNotes";
  if (type === "CHANGE_REQUEST") return "changeRequests";
  if (type === "READY_FOR_REVIEW" || type === "CHANGES_REQUESTED") return "readyForReview";
  if (type === "DOCUMENT_UPLOADED") return "documentUploaded";
  return null;
}

/** Creates an in-app notification row and (if configured) sends an email. */
export async function notify({ userId, type, message, link }: NotifyArgs) {
  const preferenceKey = preferenceKeyForType(type);
  if (preferenceKey) {
    const preferences = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (preferences && preferences[preferenceKey] === false) return null;
  }

  const notification = await prisma.notification.create({
    data: { userId, type, message, link },
  });

  if (process.env.SMTP_HOST) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.email) {
      const url = `${process.env.APP_URL ?? "http://localhost:3000"}${link}`;
      try {
        await transporter.sendMail({
          from: process.env.EMAIL_FROM ?? "Calari Internal <work@calari.tech>",
          to: user.email,
          subject: message,
          html: `<p>${message}</p><p><a href="${url}">Open in Calari Internal</a></p>`,
        });
      } catch (err) {
        console.error("notify: email send failed", err);
      }
    }
  }

  return notification;
}

/** Record an activity-log entry on a build. */
export async function logActivity(buildId: string, actor: string, message: string) {
  return prisma.activity.create({ data: { buildId, actor, message } });
}
