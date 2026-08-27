import { requireUser } from "@/lib/auth-helpers";
import { ChatWorkspace } from "./workspace";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  await requireUser();
  return <ChatWorkspace />;
}
