import crypto from "node:crypto";
import { Resend } from "resend";
import { nanoid } from "@/lib/utils";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

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
  if (!resend) return false;

  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? "Calari Internal <noreply@calarisolutions.com>",
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

