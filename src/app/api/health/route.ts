import { prisma } from "@/lib/db";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "ok" });
  } catch (error) {
    console.error("health: database check failed", error);
    return Response.json({ status: "degraded", db: "unreachable" });
  }
}
