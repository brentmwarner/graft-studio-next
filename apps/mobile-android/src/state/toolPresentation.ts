/// Maps a raw tool invocation onto the friendly phrases the live status
/// line shows. Mirrors iOS `ToolPresentation` / `LiveStatusPhrase`.
export const THINKING_PHRASE = "Thinking";

export function toolRunningPhrase(name: string, context = ""): string {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();
  const domain = firstDomain(context);

  if (lower.includes("search")) return "Searching the web";
  if (
    lower.includes("fetch") ||
    lower.includes("browse") ||
    lower.includes("web") ||
    lower.includes("http")
  ) {
    return domain ? `Reading ${domain}` : "Browsing the web";
  }
  if (
    lower.includes("bash") ||
    lower.includes("shell") ||
    lower.includes("terminal") ||
    lower.includes("exec") ||
    lower.includes("command")
  ) {
    return "Running a command";
  }
  if (lower.includes("write") || lower.includes("edit")) return "Editing a file";
  if (
    lower.includes("read") ||
    lower.includes("file") ||
    lower.includes("glob") ||
    lower.includes("grep")
  ) {
    return "Reading files";
  }
  if (lower.includes("image") || lower.includes("vision") || lower.includes("screenshot")) {
    return "Looking at an image";
  }
  if (lower.includes("memory") || lower.includes("recall")) {
    return "Checking memory";
  }
  if (lower.includes("task") || lower.includes("agent")) {
    return "Delegating work";
  }
  const pretty = prettyName(trimmed);
  return pretty ? `Using ${pretty}` : THINKING_PHRASE;
}

export function liveStatusPhrase(
  runningToolName?: string,
  context = "",
  fallback?: string,
): string {
  const tool = runningToolName?.trim();
  if (tool) {
    return toolRunningPhrase(tool, context);
  }
  const trimmedFallback = fallback?.trim();
  if (trimmedFallback) return trimmedFallback;
  return THINKING_PHRASE;
}

function prettyName(raw: string): string {
  const last = raw.split(".").at(-1) ?? raw;
  return last.replaceAll("_", " ").replaceAll("-", " ");
}

function firstDomain(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s"'<>]+/i);
  if (!match?.[0]) return undefined;
  const raw = match[0].replace(/[)\]},.;]+$/g, "");
  try {
    const host = new URL(raw).hostname;
    return host.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
}
