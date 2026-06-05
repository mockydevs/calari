import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, CheckCircle2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { getActiveProviderApiKey } from "@/lib/api-keys";
import { generateBrief, assignBuild } from "../../actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireAdmin();
  const build = await prisma.build.findUnique({
    where: { id },
    include: {
      contactSources: true,
      stages: { include: { manualActions: true }, orderBy: { order: "asc" } },
      tasks: { where: { aiGenerated: true }, orderBy: { createdAt: "asc" } },
      meetingNotes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!build) notFound();

  const members = await prisma.user.findMany({ where: { role: "MEMBER", active: true } });
  const hasKey = !!(await getActiveProviderApiKey("OPENAI"));

  async function doGenerate() {
    "use server";
    await generateBrief(id);
  }
  async function doAssign(formData: FormData) {
    "use server";
    const assigneeId = String(formData.get("assigneeId") ?? "");
    if (assigneeId) await assignBuild(id, assigneeId);
  }

  return (
    <div className="space-y-5">
      <Link
        href={`/builds/${id}`}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 transition-colors hover:text-slate-950"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to build
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            AI review
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Review AI draft</h1>
        </div>
        <StatusBadge status={build.status} />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100">
                <Bot className="h-4 w-4" />
              </span>
              Meeting history
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {build.meetingNotes.length > 0 ? (
              <div className="max-h-[32rem] space-y-3 overflow-auto rounded-lg bg-slate-950 p-4 ring-1 ring-slate-900">
                {build.meetingNotes.map((note, index) => {
                  const number = build.meetingNotes.length - index;
                  return (
                    <section key={note.id} className="rounded-lg bg-white/[0.04] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-cyan-100">
                          {number === 1 ? "Original meeting" : `Follow-up ${number - 1}`}
                        </p>
                        <span className="text-[10px] text-slate-500">
                          {note.createdAt.toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap text-xs leading-6 text-slate-200">
                        {note.rawText}
                      </pre>
                    </section>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
                No notes uploaded.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <form action={doGenerate}>
                <Button disabled={build.meetingNotes.length === 0 || !hasKey}>
                  <Bot className="h-4 w-4" />
                  {build.status === "DRAFT" ? "Generate draft" : "Regenerate"}
                </Button>
              </form>
              {build.meetingNotes[0] && (
                <span className="text-xs font-medium text-slate-500">
                  Latest AI status: {build.meetingNotes[0].aiStatus}
                </span>
              )}
            </div>
            {!hasKey && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-200">
                Add an active OpenAI key under AI provider settings to enable AI generation.
              </p>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Drafted brief</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Goals</p>
                  <p className="text-slate-700">{build.goals ?? "-"}</p>
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Integrations</p>
                  <p className="text-slate-700">{build.integrations ?? "-"}</p>
                </div>
              </div>
              {build.contactSources.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {build.contactSources.map((source) => (
                    <Badge key={source.id} className="bg-slate-100 text-slate-700">
                      {source.type}: {source.label}
                    </Badge>
                  ))}
                </div>
              )}
              {build.stages.length > 0 && (
                <ol className="space-y-2">
                  {build.stages.map((stage) => (
                    <li
                      key={stage.id}
                      className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-sm text-slate-700"
                    >
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-bold text-cyan-700 ring-1 ring-cyan-100">
                        {stage.order}
                      </span>
                      {stage.name}
                      {stage.needsManual && (
                        <Badge className="ml-auto bg-orange-50 text-orange-700">manual</Badge>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Drafted tasks{" "}
                <span className="ml-1.5 rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-500">
                  {build.tasks.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {build.tasks.length > 0 ? (
                build.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2.5"
                  >
                    <Badge className="shrink-0 bg-white text-slate-600 ring-1 ring-slate-200">
                      {task.type}
                    </Badge>
                    <span className="text-slate-700">{task.title}</span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-500">
                  Generate to see suggested tasks. Edit them on the build page after assigning.
                </p>
              )}
            </CardContent>
          </Card>

          {build.status !== "DRAFT" && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                    <CheckCircle2 className="h-4 w-4" />
                  </span>
                  Approve and assign
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={doAssign} className="space-y-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="assigneeId">Assign to team member</Label>
                    <Select id="assigneeId" name="assigneeId" defaultValue="">
                      <option value="" disabled>
                        Select member
                      </option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <Button className="w-full">Approve and assign</Button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
