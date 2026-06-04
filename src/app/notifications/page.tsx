import Link from "next/link";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { markAllRead } from "./actions";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const items = await prisma.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <form action={markAllRead}><Button variant="outline" size="sm">Mark all read</Button></form>
      </div>
      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? <p className="p-6 text-sm text-slate-500">Nothing yet.</p> : (
            <ul className="divide-y divide-slate-100">
              {items.map((n) => (
                <li key={n.id} className={`flex items-center justify-between px-5 py-3 ${n.read ? "" : "bg-slate-50"}`}>
                  <Link href={n.link} className="text-sm text-slate-800 hover:underline">{n.message}</Link>
                  <span className="text-xs text-slate-400">{formatDate(n.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
