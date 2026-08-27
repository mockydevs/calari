/** Download through the authenticated BFF; never follow an API-provided external URL. */
export async function downloadChatExport(runId: string, format: "csv" | "pdf"): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId)) throw new Error("Invalid report identifier.");
  const response = await fetch(`/api/portal/ghl-chat/runs/${runId}/export/${format}/`, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(response.status === 401 || response.status === 403
      ? "Your access to this report has expired. Sign in again or ask an administrator."
      : "The report could not be downloaded. Refresh the conversation and try again.");
  }
  const mime = response.headers.get("content-type") || "";
  if (!(format === "pdf" ? mime.includes("application/pdf") : mime.includes("text/csv"))) {
    throw new Error("The server did not return the requested report format.");
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `ghl-report-${runId}.${format}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
