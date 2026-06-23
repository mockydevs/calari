"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "success" | "error" | "info";

type ToastAction = { label: string; onClick: () => void; variant?: "primary" | "danger" };

type ToastItem = {
  id: number;
  message: string;
  title?: string;
  variant: Variant;
  duration: number | null; // null = sticky (until dismissed / acted on)
  actions?: ToastAction[];
};

type ConfirmOptions = {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
};

type ToastApi = {
  show: (t: Omit<ToastItem, "id">) => number;
  dismiss: (id: number) => void;
  success: (message: string, title?: string) => number;
  error: (message: string, title?: string) => number;
  info: (message: string, title?: string) => number;
  confirm: (opts: ConfirmOptions) => void;
};

const ToastContext = React.createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

const ICONS: Record<Variant, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

const ACCENT: Record<Variant, string> = {
  success: "text-emerald-600",
  error: "text-red-600",
  info: "text-cyan-700",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);
  const idRef = React.useRef(0);
  const timers = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = React.useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const show = React.useCallback(
    (t: Omit<ToastItem, "id">) => {
      const id = ++idRef.current;
      const item: ToastItem = { id, ...t };
      setToasts((prev) => [...prev, item]);
      if (item.duration !== null) {
        timers.current.set(id, setTimeout(() => dismiss(id), item.duration));
      }
      return id;
    },
    [dismiss],
  );

  const api = React.useMemo<ToastApi>(() => {
    const quick = (variant: Variant) => (message: string, title?: string) =>
      show({ message, title, variant, duration: 4000 });
    return {
      show,
      dismiss,
      success: quick("success"),
      error: quick("error"),
      info: quick("info"),
      confirm: ({ message, title, confirmLabel = "Confirm", cancelLabel = "Cancel", danger, onConfirm }) => {
        const id = show({
          message,
          title,
          variant: danger ? "error" : "info",
          duration: null,
          actions: [
            { label: cancelLabel, onClick: () => dismiss(id), variant: "primary" },
            {
              label: confirmLabel,
              variant: danger ? "danger" : "primary",
              onClick: () => {
                dismiss(id);
                onConfirm();
              },
            },
          ],
        });
      },
    };
    // `id` referenced inside confirm is created by show(); the closure captures it after assignment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2.5"
      >
        {toasts.map((t) => {
          const Icon = ICONS[t.variant];
          return (
            <div
              key={t.id}
              role={t.variant === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200/80 bg-white/95 p-3.5 pr-2.5",
                "shadow-lg shadow-slate-900/[0.08] backdrop-blur",
                "animate-[toast-in_180ms_cubic-bezier(0.16,1,0.3,1)]",
              )}
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", ACCENT[t.variant])} />
              <div className="min-w-0 flex-1">
                {t.title && <p className="text-sm font-semibold text-slate-950">{t.title}</p>}
                <p className={cn("text-sm text-slate-600", t.title && "mt-0.5")}>{t.message}</p>
                {t.actions && t.actions.length > 0 && (
                  <div className="mt-2.5 flex justify-end gap-2">
                    {t.actions.map((a) => (
                      <button
                        key={a.label}
                        onClick={a.onClick}
                        className={cn(
                          "inline-flex h-8 items-center rounded-md px-3 text-xs font-semibold transition-colors",
                          a.variant === "danger"
                            ? "bg-red-600 text-white hover:bg-red-700"
                            : a.variant === "primary"
                              ? "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                              : "text-slate-600 hover:bg-slate-100",
                        )}
                      >
                        {a.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

/** Small inline spinner for pending action buttons. */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-4 w-4 animate-spin", className)} />;
}
