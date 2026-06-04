import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { auth } from "@/auth";
import { TopNav } from "@/components/top-nav";

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
  const session = await auth();
  return (
    <html lang="en" className={plusJakarta.variable}>
      <body className="min-h-screen bg-[#f6f8fb] text-slate-950 antialiased">
        {session?.user ? <TopNav user={session.user} /> : null}
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
