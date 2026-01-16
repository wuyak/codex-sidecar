const _LS_SKIN = "codex_sidecar_ui_skin";

function _sanitize(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "flat") return "flat";
  return "default";
}

function _apply(skin) {
  try { document.body.dataset.bmSkin = skin; } catch (_) {}
}

export function initSkin(dom, opts = {}) {
  let skin = "default";
  try { skin = _sanitize(localStorage.getItem(_LS_SKIN)); } catch (_) {}
  _apply(skin);
  try { if (dom && dom.uiSkin) dom.uiSkin.value = skin; } catch (_) {}

  const setStatus = (opts && typeof opts.setStatus === "function") ? opts.setStatus : null;
  if (dom && dom.uiSkin) {
    dom.uiSkin.addEventListener("change", () => {
      const next = _sanitize(dom.uiSkin.value);
      _apply(next);
      try { localStorage.setItem(_LS_SKIN, next); } catch (_) {}
      try { dom.uiSkin.value = next; } catch (_) {}
      if (setStatus) setStatus(dom, `皮肤已切换：${next}`);
    });
  }
}

