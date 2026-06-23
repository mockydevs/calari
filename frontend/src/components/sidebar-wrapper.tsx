"use client";
import React, { useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SidebarWrapper({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  function closeAfterNavigation(event: React.MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("a")) setIsOpen(false);
  }

  return (
    <>
      {/* Mobile top bar — hidden on lg+ */}
      <header className="fixed inset-x-0 top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200/80 bg-white/90 px-4 shadow-sm shadow-slate-900/[0.03] backdrop-blur-xl lg:hidden">
        <button
          onClick={() => setIsOpen(true)}
          className="rounded-md p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-pink-500 to-emerald-500 text-xs font-black text-white shadow-sm">
            CI
          </span>
          <span className="text-sm font-semibold text-slate-950">Calari Internal</span>
        </div>
      </header>

      {/* Backdrop overlay */}
      <div
        className={cn(
          "fixed inset-0 z-30 bg-slate-950/55 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          isOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar panel */}
      <div
        onClick={closeAfterNavigation}
        className={cn(
          "fixed inset-y-0 left-0 z-40 transition-transform duration-300 ease-in-out lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <button
          onClick={() => setIsOpen(false)}
          className="absolute right-3 top-3 rounded-md p-1 text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white lg:hidden"
          aria-label="Close navigation"
        >
          <X className="h-5 w-5" />
        </button>
        {children}
      </div>
    </>
  );
}
