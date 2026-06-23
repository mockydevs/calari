"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileText, UploadCloud, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const AI_READABLE_EXTENSIONS = new Set([".pdf", ".docx", ".txt", ".csv", ".md", ".rtf"]);

function extensionFor(filename: string) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}

function isAiReadable(file: File) {
  return (
    AI_READABLE_EXTENSIONS.has(extensionFor(file.name)) ||
    file.type === "application/pdf" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type.startsWith("text/")
  );
}

export function IntakeBriefDropzone() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");

  function setFile(file: File | null) {
    setError("");
    if (!file) {
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(null);
      setError("File must be 15 MB or smaller.");
      return;
    }
    if (!isAiReadable(file)) {
      setSelectedFile(null);
      setError("Use PDF, DOCX, TXT, CSV, MD, or RTF so the AI can read the brief.");
      return;
    }
    setSelectedFile(file);
  }

  function onDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0] ?? null;
    if (file && inputRef.current) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      inputRef.current.files = dataTransfer.files;
    }
    setFile(file);
  }

  return (
    <div className="flex flex-1 flex-col gap-2">
      <label
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-[300px] flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed bg-slate-50/80 px-4 py-6 text-center transition-colors duration-200",
          isDragging
            ? "border-cyan-500 bg-cyan-50 text-cyan-800"
            : "border-slate-300 text-slate-600 hover:border-cyan-300 hover:bg-cyan-50/40",
        )}
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-white text-cyan-700 ring-1 ring-slate-200">
          {selectedFile ? <FileText className="h-5 w-5" /> : <UploadCloud className="h-5 w-5" />}
        </span>
        <span className="mt-3 text-sm font-semibold text-slate-950">
          {selectedFile ? selectedFile.name : "Drop brief file here"}
        </span>
        <span className="mt-1 text-xs text-slate-500">
          PDF, DOCX, TXT, CSV, MD, RTF - 15 MB max
        </span>
        <input
          ref={inputRef}
          name="briefFile"
          type="file"
          accept=".pdf,.docx,.txt,.csv,.md,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv,text/markdown"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </label>
      {selectedFile ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">Selected</p>
            <p className="truncate text-emerald-700/80">{selectedFile.name}</p>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="flex items-center gap-2 text-xs font-medium text-red-700">
          <XCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
