import Link from "next/link";
import { ArrowRight, CalendarClock, CheckCircle2, List, Plus, UserRound } from "lucide-react";
import { requireUser } from "@/lib/auth-helpers";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { BuildStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STAGES: {
  status: BuildStatus;
  label: string;
  tone: string;
  dot: string;
  badge: string;
}[] = [
  {
    status: "DRAFT",
    label: "Draft",
    tone: "border-slate-200",
    dot: "bg-slate-300 ring-slate-200",
    badge: "bg-slate-100 text-slate-600",
  },
  {
    status: "AI_DRAFTED",
    label: "AI Drafted",
    tone: "border-violet-200",
    dot: "bg-violet-500 ring-violet-100",
    badge: "bg-violet-50 text-violet-700",
  },
  {
    status: "ASSIGNED",
    label: "Assigned",
    tone: "border-cyan-200",
    dot: "bg-cyan-500 ring-cyan-100",
    badge: "bg-cyan-50 text-cyan-700",
  },
  {
    status: "IN_PROGRESS",
    label: "In Progress",
    tone: "border-amber-200",
    dot: "bg-amber-500 ring-amber-100",
    badge: "bg-amber-50 text-amber-700",
  },
  {
    status: "READY_FOR_REVIEW",
    label: "For Review",
    tone: "border-indigo-200",
    dot: "bg-indigo-500 ring-indigo-100",
    badge: "bg-indigo-50 text-indigo-700",
  },
  {
    status: "CHANGES_REQUESTED",
    label: "Changes",
    tone: "border-orange-200",
    dot: "bg-orange-500 ring-orange-100",
    badge: "bg-orange-50 text-orange-700",
  },
  {
    status: "DELIVERED",
    label: "Delivered",
    tone: "border-emerald-200",
    dot: "bg-emerald-500 ring-emerald-100",
    badge: "bg-emerald-50 text-emerald-700",
  },
];

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function KanbanPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  const builds = await prisma.build.findMany({
    where: isAdmin ? {} : { assigneeId: user.id },
    include: { client: true, assignee: true, _count: { select: { tasks: true } } },
    orderBy: { updatedAt: "desc" },
  });

  const byStatus = Object.fromEntries(
    STAGES.map(({ status }) => [status, builds.filter((build) => build.status === status)]),
  ) as Record<BuildStatus, typeof builds>;

  const activeStages = STAGES.filter(({ status }) => (byStatus[status] ?? []).length > 0);
  const activeStage = activeStages.find(({ status }) => status !== "DELIVERED") ?? activeStages[0] ?? STAGES[0];
  const activeBuild =
    activeStages
      .flatMap(({ status }) => byStatus[status] ?? [])
      .find((build) => build.status !== "DELIVERED") ?? builds[0];
  const totalTasks = builds.reduce((sum, build) => sum + build._count.tasks, 0);
  const deliveredCount = byStatus.DELIVERED?.length ?? 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
            Delivery flow
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">Status board</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Follow each build through the vertical delivery pipeline.
          </p>
        </div>

        <div className="rounded-lg border border-white/80 bg-white/85 p-3 shadow-sm shadow-slate-900/[0.04] backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Board actions</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-950">
                {builds.length} build{builds.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/builds"
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition-colors duration-200 hover:border-slate-400 hover:bg-slate-50"
              >
                <List className="h-4 w-4 text-slate-500" />
                List
              </Link>
              {isAdmin && (
                <Link
                  href="/builds/new"
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-cyan-700 px-3 text-sm font-semibold text-white shadow-sm shadow-cyan-900/10 transition-colors duration-200 hover:bg-cyan-800"
                >
                  <Plus className="h-4 w-4" />
                  New
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,760px)_320px] lg:items-start">
        <div className="space-y-0">
          {STAGES.map((stage, index) => {
            const cards = byStatus[stage.status] ?? [];
            const hasBuilds = cards.length > 0;
            const nextStageHasBuilds =
              index < STAGES.length - 1 && (byStatus[STAGES[index + 1].status] ?? []).length > 0;
            const isLast = index === STAGES.length - 1;

            return (
              <section key={stage.status} className="grid grid-cols-[42px_minmax(0,1fr)] gap-3">
                <div className="relative flex justify-center">
                  <span
                    className={cn(
                      "mt-5 flex h-4 w-4 rounded-full ring-4",
                      hasBuilds ? stage.dot : "bg-white ring-slate-200",
                    )}
                  />
                  {!isLast && (
                    <span
                      className={cn(
                        "flow-line absolute bottom-0 top-11 w-px rounded-full",
                        (hasBuilds || nextStageHasBuilds) && "flow-line-active",
                      )}
                    />
                  )}
                </div>

                <div className={cn("pb-4", !isLast && "border-b border-slate-200/70")}>
                  <div
                    className={cn(
                      "overflow-hidden rounded-lg border bg-white shadow-sm shadow-slate-900/[0.03]",
                      hasBuilds ? stage.tone : "border-slate-200/80",
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={cn("rounded-md px-2 py-0.5 text-xs font-semibold", stage.badge)}>
                          {stage.label}
                        </span>
                        <span className="text-xs text-slate-500">
                          {cards.length} build{cards.length !== 1 ? "s" : ""}
                        </span>
                      </div>
                      {stage.status === activeStage.status && hasBuilds && (
                        <span className="inline-flex items-center gap-1.5 rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700">
                          <ArrowRight className="h-3.5 w-3.5" />
                          Current
                        </span>
                      )}
                    </div>

                    {cards.length === 0 ? (
                      <div className="px-4 py-4">
                        <p className="text-xs text-slate-400">No builds in this stage.</p>
                      </div>
                    ) : (
                      <div className="grid gap-3 p-4">
                        {cards.map((build) => {
                          const assigneeInitials = build.assignee ? initials(build.assignee.name) : null;
                          return (
                            <Link
                              key={build.id}
                              href={`/builds/${build.id}`}
                              className="group rounded-lg border border-slate-200 bg-white p-4 transition-all duration-200 hover:border-cyan-200 hover:bg-cyan-50/30 hover:shadow-md"
                            >
                              <div className="flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                  <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-950 group-hover:text-cyan-700">
                                    {build.title}
                                  </p>
                                  <p className="mt-1 text-xs text-slate-500">{build.client.name}</p>
                                </div>
                                {assigneeInitials ? (
                                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-[10px] font-bold text-cyan-700 ring-1 ring-cyan-100">
                                    {assigneeInitials}
                                  </span>
                                ) : (
                                  <span className="shrink-0 rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                                    Open
                                  </span>
                                )}
                              </div>

                              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                                <span>{build._count.tasks} task{build._count.tasks !== 1 ? "s" : ""}</span>
                                {build.assignee && (
                                  <span className="inline-flex items-center gap-1.5">
                                    <UserRound className="h-3.5 w-3.5" />
                                    {build.assignee.name}
                                  </span>
                                )}
                                {build.dueDate && (
                                  <span className="inline-flex items-center gap-1.5">
                                    <CalendarClock className="h-3.5 w-3.5" />
                                    {formatDate(build.dueDate)}
                                  </span>
                                )}
                              </div>
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </section>
            );
          })}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-8">
          <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700">
              Pipeline detail
            </p>
            <h2 className="mt-2 text-lg font-semibold tracking-tight text-slate-950">
              {activeBuild ? activeBuild.title : "No active build"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {activeBuild ? activeBuild.client.name : "Create a build to start the delivery flow."}
            </p>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-lg font-semibold text-slate-950">{builds.length}</p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Builds</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-lg font-semibold text-slate-950">{totalTasks}</p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Tasks</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-lg font-semibold text-slate-950">{deliveredCount}</p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Done</p>
              </div>
            </div>

            {activeBuild && (
              <Link
                href={`/builds/${activeBuild.id}`}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-cyan-700 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cyan-800"
              >
                Open build
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>

          <div className="rounded-lg border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-900/[0.03]">
            <h2 className="text-sm font-semibold text-slate-950">Stage progress</h2>
            <ul className="mt-4 space-y-3">
              {STAGES.map((stage) => {
                const count = byStatus[stage.status]?.length ?? 0;
                const hasBuilds = count > 0;
                return (
                  <li key={stage.status} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-2.5 w-2.5 shrink-0 rounded-full ring-2",
                          hasBuilds ? stage.dot : "bg-white ring-slate-200",
                        )}
                      />
                      <span className="truncate text-sm font-medium text-slate-700">{stage.label}</span>
                    </div>
                    <span className="text-xs font-semibold text-slate-500">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 p-4 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              Vertical flow
            </div>
            <p className="mt-1 text-xs leading-5">
              The animated connector highlights stages that currently contain work.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
