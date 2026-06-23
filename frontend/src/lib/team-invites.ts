import crypto from "node:crypto";
import nodemailer from "nodemailer";
import { nanoid } from "@/lib/utils";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

export function createInviteToken() {
  return nanoid(32);
}

export function hashInviteToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function signupUrlForToken(token: string) {
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return `${appUrl.replace(/\/$/, "")}/signup/${token}`;
}

export async function sendTeamInviteEmail({
  email,
  name,
  inviteUrl,
}: {
  email: string;
  name: string;
  inviteUrl: string;
}) {
  if (!process.env.SMTP_HOST) return false;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM ?? "Calari Internal <work@calari.tech>",
    to: email,
    subject: "You're invited to Calari Internal",
    html: `
      <p>Hi ${name},</p>
      <p>You have been invited to create your Calari Internal account.</p>
      <p><a href="${inviteUrl}">Complete your signup</a></p>
      <p>Your account will be reviewed by an admin before you can sign in.</p>
    `,
  });

  return true;
}

