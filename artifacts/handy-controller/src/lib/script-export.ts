import type { ScriptOutputFiletype } from "@/hooks/use-app-settings";

export interface ScriptAction {
  at: number;
  pos: number;
}

/** Convert an array of script actions to a CSV string (time in seconds, position). */
export function actionsToCSV(actions: ScriptAction[]): string {
  const rows = actions.map(({ at, pos }) => `${(at / 1000).toFixed(3)},${pos}`);
  return ["time,position", ...rows].join("\n");
}

/** Convert a raw funscript JSON string to CSV. Returns null if parsing fails. */
export function funscriptJsonToCSV(funscriptJson: string): string | null {
  try {
    const parsed = JSON.parse(funscriptJson) as { actions?: ScriptAction[] };
    return actionsToCSV(parsed.actions ?? []);
  } catch {
    return null;
  }
}

export interface ExportResult {
  content: string;
  mimeType: string;
  ext: string;
}

/** Build export content, MIME type, and file extension for the given filetype. */
export function buildScriptExport(
  actions: ScriptAction[],
  filetype: ScriptOutputFiletype,
): ExportResult {
  if (filetype === "csv") {
    return { content: actionsToCSV(actions), mimeType: "text/csv", ext: "csv" };
  }
  return {
    content: JSON.stringify({ actions }, null, 2),
    mimeType: "application/json",
    ext: "funscript",
  };
}

/** Trigger a browser file download with the given content. */
export function triggerDownload(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
