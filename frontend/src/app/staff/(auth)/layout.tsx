import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { ACCESS_COOKIE } from "@/lib/portal/config";
import { ThemeScope } from "@/components/portal/theme";

export default async function PortalAuthLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  if (store.get(ACCESS_COOKIE)) redirect("/staff");

  return (
    <ThemeScope>
      <div
        className="flex min-h-screen items-center justify-center p-5"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 55% 40% at 15% 20%, rgba(59,130,246,0.08), transparent), radial-gradient(ellipse 45% 45% at 85% 80%, rgba(129,140,248,0.06), transparent)",
        }}
      >
        {children}
      </div>
    </ThemeScope>
  );
}
