import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/portal/config";
import { getPortalUser } from "@/lib/portal/server";
import type { User } from "@/lib/portal/types";
import { ThemeScope } from "@/components/portal/theme";
import { ToastProvider } from "@/components/portal/toast";
import { PortalUserProvider } from "@/components/portal/user-context";
import { PortalShell } from "@/components/portal/shell";

export default async function PortalAppLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const hasSession = store.get(ACCESS_COOKIE) || store.get(REFRESH_COOKIE);
  if (!hasSession) redirect("/staff/login");

  const initialUser = (await getPortalUser()) as User | null;

  return (
    <ThemeScope>
      <ToastProvider>
        <PortalUserProvider initialUser={initialUser}>
          <PortalShell>{children}</PortalShell>
        </PortalUserProvider>
      </ToastProvider>
    </ThemeScope>
  );
}
