export const AI_READABLE_EXTENSIONS = [".pdf", ".docx", ".txt", ".csv", ".md", ".rtf"] as const;
export const ATTACHMENT_EXTENSIONS = [
  ...AI_READABLE_EXTENSIONS,
  ".doc",
  ".xls",
  ".xlsx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
] as const;

const MAX_TEXT_CHARS = 24000;

function extensionFor(filename: string) {
  const index = filename.lastIndexOf(".");
  return index === -1 ? "" : filename.slice(index).toLowerCase();
}

function normalizeText(text: string) {
  return text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

export function isAiReadableDocument(filename: string, contentType?: string) {
  const ext = extensionFor(filename);
  return (
    AI_READABLE_EXTENSIONS.includes(ext as (typeof AI_READABLE_EXTENSIONS)[number]) ||
    contentType === "application/pdf" ||
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    contentType?.startsWith("text/")
  );
}

export async function extractDocumentText(file: File): Promise<{ text: string; supported: boolean; reason?: string }> {
  const filename = file.name;
  const contentType = file.type;
  const ext = extensionFor(filename);
  const buffer = Buffer.from(await file.arrayBuffer());

  if (contentType?.startsWith("text/") || [".txt", ".csv", ".md", ".rtf"].includes(ext)) {
    return { text: normalizeText(buffer.toString("utf8")).slice(0, MAX_TEXT_CHARS), supported: true };
  }

  if (contentType === "application/pdf" || ext === ".pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      return { text: normalizeText(result.text).slice(0, MAX_TEXT_CHARS), supported: true };
    } finally {
      await parser.destroy();
    }
  }

  if (
    contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    ext === ".docx"
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return { text: normalizeText(result.value).slice(0, MAX_TEXT_CHARS), supported: true };
  }

  if (ext === ".doc") {
    return {
      text: "",
      supported: false,
      reason: "Legacy .doc files can be attached, but they are not AI-readable. Convert to .docx, PDF, or TXT for AI drafting.",
    };
  }

  return {
    text: "",
    supported: false,
    reason: "This file type can be attached, but it is not AI-readable for brief generation.",
  };
}
