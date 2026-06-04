"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, Loader2, Paperclip, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

type Props = {
  buildId?: string;
  taskId?: string;
  compact?: boolean;
};

export function DocumentUploader({ buildId, taskId, compact = false }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [isUploading, setIsUploading] = useState(false);

  function onFileChange(file: File | null) {
    setMessage("");
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
    if (file.type && !ALLOWED_TYPES.has(file.type)) {
      setSelectedFile(null);
      setError("Upload a PDF, document, spreadsheet, text file, or image.");
      return;
    }
    setSelectedFile(file);
  }

  async function uploadSelectedFile() {
    if (!selectedFile || isUploading) return;
    setMessage("");
    setError("");

    setIsUploading(true);
    try {
      const metadata = {
        filename: selectedFile.name,
        contentType: selectedFile.type || "application/octet-stream",
        sizeBytes: selectedFile.size,
        buildId,
        taskId,
      };

      const presign = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata),
      });
      if (!presign.ok) {
        const body = await presign.json().catch(() => null);
        throw new Error(body?.error ?? "Could not start upload.");
      }

      const { uploadUrl, key } = (await presign.json()) as { uploadUrl: string; key: string };
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": metadata.contentType },
        body: selectedFile,
      });
      if (!put.ok) throw new Error("Storage upload failed.");

      const confirm = await fetch("/api/upload", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...metadata, key }),
      });
      if (!confirm.ok) {
        const body = await confirm.json().catch(() => null);
        throw new Error(body?.error ?? "Could not save uploaded file.");
      }

      setSelectedFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setMessage("Upload complete.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className={cn("rounded-md border border-dashed border-slate-300 bg-slate-50 p-3", compact ? "space-y-2" : "space-y-3")}>
      <label className="flex cursor-pointer items-center gap-3 rounded-md bg-white px-3 py-3 text-sm text-slate-700 ring-1 ring-inset ring-slate-200 transition-colors hover:bg-slate-50">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-700">
          <FileUp className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-slate-950">{selectedFile ? selectedFile.name : "Choose file"}</span>
          <span className="block truncate text-xs text-slate-500">PDF, docs, sheets, text, or images up to 15 MB</span>
        </span>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" onClick={uploadSelectedFile} disabled={!selectedFile || isUploading}>
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          Upload
        </Button>
        {selectedFile ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelectedFile(null);
              setError("");
              setMessage("");
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            Clear
          </Button>
        ) : null}
      </div>

      {message ? (
        <p className="flex items-center gap-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="flex items-center gap-2 text-xs text-red-700">
          <XCircle className="h-4 w-4" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
