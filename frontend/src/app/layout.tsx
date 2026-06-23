import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { getAppUser } from "@/lib/auth-helpers";
import { Sidebar } from "@/components/sidebar";
import { SidebarWrapper } from "@/components/sidebar-wrapper";

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
        {user ? (
          <div className="flex min-h-screen">
            <SidebarWrapper>
              <Sidebar user={user} />
            </SidebarWrapper>
            <div className="flex min-h-screen flex-1 flex-col lg:pl-72">
              <main className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-4 pb-10 pt-[76px] sm:px-6 lg:px-8 lg:pt-8">
                {children}
              </main>
            </div>
          </div>
        ) : (
          <main className="min-h-screen">{children}</main>
        )}
      </body>
    </html>
  );
}
