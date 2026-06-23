import * as React from "react";
import { cn } from "@/lib/utils";

const variants = {
  default: "bg-gradient-to-r from-pink-600 to-fuchsia-600 text-white shadow-sm shadow-pink-900/15 hover:from-pink-700 hover:to-fuchsia-700",
  primary: "bg-slate-950 text-white shadow-sm shadow-slate-900/10 hover:bg-slate-800",
  outline: "border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50",
  ghost: "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
  danger: "bg-red-600 text-white shadow-sm shadow-red-900/10 hover:bg-red-700",
  success: "bg-emerald-600 text-white shadow-sm shadow-emerald-900/10 hover:bg-emerald-700",
};
const sizes = {
  sm: "h-8 rounded-md px-3 text-xs",
  md: "h-9 rounded-md px-4 text-sm",
  lg: "h-11 rounded-md px-5 text-sm",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex cursor-pointer items-center justify-center gap-2 font-semibold transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
