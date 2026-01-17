export function extractExitCode(outputRaw) {
  const lines = String(outputRaw ?? "").split("\n");
  for (const ln of lines) {
    if (ln.startsWith("Exit code:")) {
      const v = ln.split(":", 2)[1] || "";
      const n = parseInt(v.trim(), 10);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

export function extractWallTime(outputRaw) {
  const lines = String(outputRaw ?? "").split("\n");
  for (const ln of lines) {
    if (ln.startsWith("Wall time:")) {
      const v = ln.split(":", 2)[1] || "";
      return v.trim();
    }
  }
  return "";
}

export function extractOutputBody(outputRaw) {
  const lines = String(outputRaw ?? "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] || "").trim() === "Output:") {
      const body = lines.slice(i + 1).join("\n");
      return body.replace(/^\n+/, "");
    }
  }
  return String(outputRaw ?? "");
}

