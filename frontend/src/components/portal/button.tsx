"use client";
import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/portal/format";

type Variant = "primary" | "secondary" | "danger";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "sm";
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "portal-btn",
        variant === "primary" && "portal-btn-primary",
        variant === "secondary" && "portal-btn-secondary",
        variant === "danger" && "portal-btn-danger",
        size === "sm" && "portal-btn-sm",
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  );
}

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: "default" | "primary" | "danger";
}

export function IconButton({ tone = "default", className, children, ...props }: IconButtonProps) {
  return (
    <button
      className={cn(
        "portal-icon-btn",
        tone === "primary" && "portal-icon-btn-primary",
        tone === "danger" && "portal-icon-btn-danger",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
