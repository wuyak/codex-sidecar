import { api } from "../api.js";
import { maybePlayNotifySound, preloadNotifySound } from "../../sound.js";

const wireSfxSelect = (dom, state, sel, { field, kind }) => {
  if (!sel) return;
  sel.addEventListener("change", async () => {
    const v = String(sel.value || "none").trim() || "none";
    try {
      if (kind === "tool_gate") state.notifySoundToolGate = v;
      else state.notifySoundAssistant = v;
    } catch (_) {}
    try { preloadNotifySound(state); } catch (_) {}
    try { await api("POST", "/api/config", { [field]: v }); } catch (_) {}
    try { if (v !== "none") maybePlayNotifySound(dom, state, { kind, force: true }); } catch (_) {}
  });
};

export function wireSfxSelects(dom, state) {
  wireSfxSelect(dom, state, dom && dom.notifySoundAssistant, { field: "notify_sound_assistant", kind: "assistant" });
  wireSfxSelect(dom, state, dom && dom.notifySoundToolGate, { field: "notify_sound_tool_gate", kind: "tool_gate" });
}

