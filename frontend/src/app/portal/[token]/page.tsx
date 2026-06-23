import { notFound } from "next/navigation";
import { FileText, MessageSquare } from "lucide-react";
import { prisma } from "@/lib/db";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/utils";
import { submitPortalFeedback } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClientPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const build = await prisma.build.findFirst({
    where: { clientPortalToken: token, clientPortalEnabled: true },
    include: {
      client: true,
      tasks: { orderBy: { createdAt: "asc" } },
      documents: { orderBy: { createdAt: "desc" } },
      changeRequests: { orderBy: { createdAt: "desc" } },
      approvals: { orderBy: { createdAt: "desc" } },
      portalFeedback: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!build) notFound();

  async function doFeedback(formData: FormData) {
    "use server";
    await submitPortalFeedback(token, formData);
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#ecfeff_0%,#f8fafc_44%,#eef2f7_100%)] px-4 py-8 text-slate-950">
      <div className="mx-auto max-w-5xl space-y-5">
        <section className="rounded-lg border border-white/80 bg-white/90 p-6 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">Client portal</p>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{build.title}</h1>
              <p className="mt-1 text-sm text-slate-600">{build.client.name}</p>
            </div>
            <StatusBadge status={build.status} />
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
          <div className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold">Progress</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {build.tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">{task.title}</p>
                      <StatusBadge status={task.status} kind="task" />
                    </div>
                    {task.description && <p className="mt-1 text-xs text-slate-500">{task.description}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold">Shared documents</h2>
              {build.documents.length === 0 ? (
                <p className="mt-3 text-sm text-slate-500">No documents shared yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {build.documents.map((doc) => (
                    <li key={doc.id}>
                      <a href={doc.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm font-semibold text-cyan-700 hover:bg-cyan-50">
                        <FileText className="h-4 w-4" />
                        {doc.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-5">
            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold">Change requests</h2>
              <ul className="mt-3 space-y-2">
                {build.changeRequests.length === 0 ? (
                  <li className="text-sm text-slate-500">No changes recorded.</li>
                ) : build.changeRequests.map((change) => (
                  <li key={change.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-950">{change.title}</span>
                      <Badge className="bg-slate-100 text-slate-700">{change.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold">Approvals</h2>
              <ul className="mt-3 space-y-2">
                {build.approvals.length === 0 ? (
                  <li className="text-sm text-slate-500">No approvals recorded yet.</li>
                ) : build.approvals.map((approval) => (
                  <li key={approval.id} className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    {approval.type} - {formatDate(approval.createdAt)}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <MessageSquare className="h-4 w-4 text-cyan-700" />
                Feedback
              </h2>
              <form action={doFeedback} className="mt-3 space-y-2">
                <Input name="name" placeholder="Your name" />
                <Textarea name="message" rows={4} placeholder="Leave feedback or approval notes" required />
                <Button size="sm" className="w-full">Send feedback</Button>
              </form>
              {build.portalFeedback.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {build.portalFeedback.slice(0, 3).map((item) => (
                    <li key={item.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <p className="font-semibold text-slate-950">{item.name ?? "Client"}</p>
                      <p className="mt-1">{item.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

