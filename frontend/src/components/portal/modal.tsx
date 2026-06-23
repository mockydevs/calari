"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/portal/format";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const maxW = size === "sm" ? 400 : size === "lg" ? 720 : 480;

  return createPortal(
    <div
      className="portal-modal-backdrop portal-root"
      data-theme={document.documentElement.getAttribute("data-theme") || "dark"}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cn("portal-modal portal-fade-in")} style={{ maxWidth: maxW }}>
        {title !== undefined && (
          <div className="portal-modal-header">
            <h2 className="text-[0.95rem] font-bold">{title}</h2>
            <button className="portal-icon-btn" onClick={onClose} aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <div className="portal-modal-body">{children}</div>
        {footer && <div className="portal-modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
