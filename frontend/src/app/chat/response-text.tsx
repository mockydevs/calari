import { Fragment } from "react";

function inline(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i} className="font-semibold text-slate-950">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-slate-100 px-1 py-0.5 text-xs">{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/** Text-only formatting. API/AI content never becomes raw HTML or executable links. */
export function ResponseText({ text }: { text: string }) {
  return <div className="space-y-3 break-words text-sm leading-7 text-slate-700">
    {text.split(/\n{2,}/).map((block, i) => {
      if (/^#{1,4} /.test(block)) return <h3 key={i} className="font-semibold text-slate-950">{inline(block.replace(/^#{1,4} /, ""))}</h3>;
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*] /.test(line))) {
        return <ul key={i} className="list-disc space-y-1 pl-5">{lines.map((line, j) => <li key={j}>{inline(line.slice(2))}</li>)}</ul>;
      }
      if (lines.every((line) => /^\d+\. /.test(line))) {
        return <ol key={i} className="list-decimal space-y-1 pl-5">{lines.map((line, j) => <li key={j}>{inline(line.replace(/^\d+\. /, ""))}</li>)}</ol>;
      }
      return <p key={i} className="whitespace-pre-wrap">{inline(block)}</p>;
    })}
  </div>;
}
