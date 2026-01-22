import { safeJsonParse } from "../utils.js";
import { inferToolName, parseToolCallText } from "../format.js";

function _extractUpdatePlanFromParallelArgs(argsObj) {
  try {
    if (!argsObj || typeof argsObj !== "object") return null;
    const uses = Array.isArray(argsObj.tool_uses) ? argsObj.tool_uses : [];
    for (const it of uses) {
      if (!it || typeof it !== "object") continue;
      const rn = String(it.recipient_name || it.tool || it.name || "").trim();
      if (!rn) continue;
      const norm = rn.replace(/^functions\./, "").replace(/^multi_tool_use\./, "");
      if (norm === "update_plan" || norm.endsWith(".update_plan")) {
        const p = it.parameters;
        if (p && typeof p === "object") return p;
      }
    }
  } catch (_) {}
  return null;
}

export function classifyToolCallText(text) {
  const parsed = parseToolCallText(text || "");
  const argsRaw = String(parsed.argsRaw || "").trimEnd();
  const argsObj = safeJsonParse(argsRaw);
  const toolName = inferToolName(parsed.toolName || "", argsRaw, argsObj) || String(parsed.toolName || "");
  const callId = String(parsed.callId || "").trim();

  let planArgs = null;
  let isPlanUpdate = false;
  try {
    if (toolName === "parallel") {
      planArgs = _extractUpdatePlanFromParallelArgs(argsObj);
      isPlanUpdate = !!planArgs || String(argsRaw || "").includes("update_plan");
    }
  } catch (_) {}
  if (toolName === "update_plan") {
    isPlanUpdate = true;
    if (argsObj && typeof argsObj === "object") planArgs = argsObj;
  }

  return { toolName, callId, argsRaw, argsObj, isPlanUpdate, planArgs };
}

