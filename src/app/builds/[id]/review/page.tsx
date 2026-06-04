import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Bot, CheckCircle2, Sparkles } from "lucide-react";
import { requireAdmin } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
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
      meetingNotes: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!build) notFound();

  const note = build.meetingNotes[0];
  const members = await prisma.user.findMany({ where: { role: "MEMBER", active: true } });
  const hasKey = !!process.env.OPENAI_API_KEY;

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Link href={`/builds/${id}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-950">
            <ArrowLeft className="h-4 w-4" />
            Open build
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-950">Review AI draft</h1>
            <StatusBadge status={build.status} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-blue-700" />
              Meeting notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {note ? (
              <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-700">{note.rawText}</pre>
            ) : (
              <p className="rounded-md bg-slate-50 px-4 py-3 text-sm text-slate-500">No notes uploaded.</p>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <form action={doGenerate}>
                <Button disabled={!note || !hasKey}>
                  <Sparkles className="h-4 w-4" />
                  {build.status === "DRAFT" ? "Generate draft" : "Regenerate"}
                </Button>
              </form>
              {note ? <span className="text-xs text-slate-500">AI status: {note.aiStatus}</span> : null}
            </div>
            {!hasKey ? <p className="mt-2 text-xs text-amber-700">Set OPENAI_API_KEY in .env to enable AI generation.</p> : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Drafted brief</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><span className="font-medium">Goals: </span><span className="text-slate-600">{build.goals ?? "-"}</span></div>
              <div><span className="font-medium">Integrations: </span><span className="text-slate-600">{build.integrations ?? "-"}</span></div>
              {build.contactSources.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {build.contactSources.map((source) => (
                    <Badge key={source.id} className="bg-slate-100 text-slate-700">{source.type}: {source.label}</Badge>
                  ))}
                </div>
              ) : null}
              <ol className="space-y-2">
                {build.stages.map((stage) => (
                  <li key={stage.id} className="rounded-md border border-slate-200 px-3 py-2 text-slate-600">
                    {stage.order}. {stage.name}{stage.needsManual ? " (manual)" : ""}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Drafted tasks ({build.tasks.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {build.tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                  <Badge className="bg-white text-slate-600 ring-1 ring-slate-200">{task.type}</Badge>
                  <span>{task.title}</span>
                </div>
              ))}
              {build.tasks.length === 0 ? <p className="text-slate-500">Generate to see suggested tasks. Edit them on the build page after assigning.</p> : null}
            </CardContent>
          </Card>

          {build.status !== "DRAFT" ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                  Approve & assign
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form action={doAssign} className="space-y-2">
                  <Label htmlFor="assigneeId">Assign to team member</Label>
                  <Select id="assigneeId" name="assigneeId" defaultValue="">
                    <option value="" disabled>Select member...</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>{member.name}</option>
                    ))}
                  </Select>
                  <Button className="w-full">Approve & assign</Button>
                </form>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
