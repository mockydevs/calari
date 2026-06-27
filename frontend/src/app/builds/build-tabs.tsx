"use client";

import * as React from "react";

type PanelProps = { id: string; label: string; count?: number; children: React.ReactNode };

/** Marker only — actual rendering is controlled by <Tabs>. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function TabPanel(_: PanelProps) {
  return null;
}

/**
 * Tabbed container. Children are <TabPanel id label count> elements; only the
 * active panel is rendered (so heavy sections stay out of the DOM until opened).
 * Falsy children (conditional tabs) are filtered out.
 */
export function Tabs({ children }: { children: React.ReactNode }) {
  const panels = React.Children.toArray(children).filter(
    React.isValidElement,
  ) as React.ReactElement<PanelProps>[];
  const [active, setActive] = React.useState(panels[0]?.props.id ?? "");
  const current = panels.find((p) => p.props.id === active) ?? panels[0];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1 border-b border-slate-200">
        {panels.map((p) => {
          const on = p.props.id === active;
          return (
            <button
              key={p.props.id}
              type="button"
              onClick={() => setActive(p.props.id)}
              className={`relative -mb-px rounded-t-md px-3.5 py-2 text-sm font-medium transition-colors ${
                on
                  ? "border-b-2 border-pink-600 text-pink-700"
                  : "border-b-2 border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {p.props.label}
              {p.props.count != null && p.props.count > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    on ? "bg-pink-100 text-pink-700" : "bg-slate-200 text-slate-600"
                  }`}
                >
                  {p.props.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="space-y-5">{current?.props.children}</div>
    </div>
  );
}
