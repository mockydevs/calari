"use client";
import * as React from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/portal/format";

type ToastType = "success" | "danger" | "warning" | "info";
interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

const ToastCtx = React.createContext<(message: string, type?: ToastType) => void>(() => {});

export function useToast() {
  return React.useContext(ToastCtx);
}

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4" />,
  danger: <XCircle className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
};

const ALERT_CLASS: Record<ToastType, string> = {
  success: "portal-alert-success",
  danger: "portal-alert-danger",
  warning: "portal-alert-warning",
  info: "portal-alert-warning",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const push = React.useCallback((message: string, type: ToastType = "success") => {
    const id = Date.now() + Math.floor(performance.now());
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      {mounted &&
        createPortal(
          <div className="portal-toast-wrap">
            {toasts.map((t) => (
              <div key={t.id} className={cn("portal-alert portal-toast portal-fade-in", ALERT_CLASS[t.type])}>
                {ICONS[t.type]}
                <span>{t.message}</span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastCtx.Provider>
  );
}
