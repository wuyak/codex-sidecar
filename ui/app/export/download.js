export function downloadTextFile(name, text, mime = "text/markdown;charset=utf-8") {
  const blob = new Blob([String(text || "")], { type: String(mime || "text/plain;charset=utf-8") });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = String(name || "download.txt");
  a.style.display = "none";
  document.body.appendChild(a);
  try { a.click(); } catch (_) {}
  setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch (_) {}
    try { if (a.parentNode) a.parentNode.removeChild(a); } catch (_) {}
  }, 120);
}

