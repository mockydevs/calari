"use client";
import * as React from "react";

type Theme = "dark" | "light";
const KEY = "calari-theme";

const ThemeCtx = React.createContext<{ theme: Theme; toggle: () => void }>({
  theme: "dark",
  toggle: () => {},
});

export function useTheme() {
  return React.useContext(ThemeCtx);
}

/**
 * Wraps the portal in `.portal-root` and manages the dark/light theme.
 * Mirrors `data-theme` onto <html> too so portaled UI (modals, toasts) inherit it.
 */
export function ThemeScope({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = React.useState<Theme>("dark");

  React.useEffect(() => {
    const saved = (localStorage.getItem(KEY) as Theme | null) ?? "dark";
    setTheme(saved);
  }, []);

  React.useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(KEY, theme);
  }, [theme]);

  const toggle = React.useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);

  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <div className="portal-root" data-theme={theme}>
        {children}
      </div>
    </ThemeCtx.Provider>
  );
}
