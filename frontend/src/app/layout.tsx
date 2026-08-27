import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { getAppUser } from "@/lib/auth-helpers";
import { Sidebar } from "@/components/sidebar";
import { SidebarWrapper } from "@/components/sidebar-wrapper";
import { ToastProvider } from "@/components/toast";
import { LoginWelcome } from "@/components/login-welcome";
import { WorkspaceHeader } from "@/components/workspace-header";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Calari Internal",
  description: "Client delivery system for Calari Solutions",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getAppUser();
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body className="min-h-screen bg-[#f5f7fb] text-slate-950 antialiased">
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-white focus:p-3">Skip to content</a>
        <ToastProvider>
          {user ? (
            <div className="flex min-h-screen">
              <LoginWelcome name={user.name} />
              <SidebarWrapper>
                <Sidebar user={user} />
              </SidebarWrapper>
              <div className="flex min-h-screen flex-1 flex-col lg:pl-72">
                <WorkspaceHeader />
                <main id="main-content" className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-4 pb-10 pt-[76px] sm:px-6 lg:px-8 lg:pt-8">
                  {children}
                </main>
              </div>
            </div>
          ) : (
            <main id="main-content" className="min-h-screen">{children}</main>
          )}
        </ToastProvider>
      </body>
    </html>
  );
}
