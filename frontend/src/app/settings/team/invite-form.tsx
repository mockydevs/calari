"use client";
import * as React from "react";
import { MailPlus, ShieldCheck } from "lucide-react";
import { createInvite } from "./actions";
import { useToast, Spinner } from "@/components/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

export function InviteForm() {
  const toast = useToast();
  const [pending, startTransition] = React.useTransition();
  const formRef = React.useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createInvite(fd);
        toast.success("Invite sent — a signup link is on its way to their inbox.", "Invite sent");
        formRef.current?.reset();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not send the invite.", "Invite failed");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5"><Label htmlFor="name">Full name</Label><Input id="name" name="name" required placeholder="Jane Smith" /></div>
      <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" name="email" type="email" required placeholder="jane@calari.com" /></div>
      <div className="space-y-1.5">
        <Label htmlFor="role">Role</Label>
        <Select id="role" name="role" defaultValue="MEMBER"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></Select>
      </div>
      <div className="rounded-lg bg-pink-50 px-3 py-3 text-xs leading-5 text-pink-800 ring-1 ring-pink-100">
        <div className="mb-1 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4" /> Invite</div>
        The invitee receives an emailed signup link to set their password.
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? <><Spinner /> Sending…</> : <><MailPlus className="h-4 w-4" /> Send invite</>}
      </Button>
    </form>
  );
}
