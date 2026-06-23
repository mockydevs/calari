import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Server-Sent Events endpoint for the notification bell.
 * Emits { unread: number } every 30 seconds so the bell badge stays current
 * without requiring a full page reload.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }
  const userId = session.user.id;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        try {
          const unread = await prisma.notification.count({ where: { userId, read: false } });
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ unread })}\n\n`));
        } catch {
          controller.close();
        }
      };

      // Initial push
      await send();

      // Poll every 30 s
      const interval = setInterval(send, 30_000);

      // Cleanup when the client disconnects
      return () => clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
