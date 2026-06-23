import * as React from "react";
import { cn } from "@/lib/utils";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "flex h-9 w-full cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 shadow-sm shadow-slate-900/[0.02] transition-colors duration-200 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-600/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-60",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
