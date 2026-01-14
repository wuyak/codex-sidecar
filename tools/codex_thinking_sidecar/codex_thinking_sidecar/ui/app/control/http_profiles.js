export function normalizeHttpProfiles(tc) {
  const profiles = Array.isArray(tc.profiles) ? tc.profiles.filter(p => p && typeof p === "object") : [];
  let selected = (typeof tc.selected === "string") ? tc.selected : "";

  // Backwards-compat: old config used {url, timeout_s, auth_env}.
  if (profiles.length === 0 && (tc.url || tc.timeout_s || tc.auth_env)) {
    profiles.push({
      name: "默认",
      url: tc.url || "",
      token: tc.token || "",
      timeout_s: (tc.timeout_s ?? 3),
      auth_env: tc.auth_env || "",
    });
    selected = "默认";
  }

  if (!selected && profiles.length > 0) selected = profiles[0].name || "默认";
  return { profiles, selected };
}

export function readHttpInputs(dom) {
  return {
    url: (dom.httpUrl && dom.httpUrl.value) ? dom.httpUrl.value : "",
    token: (dom.httpToken && dom.httpToken.value) ? dom.httpToken.value : "",
    timeout_s: Number((dom.httpTimeout && dom.httpTimeout.value) ? dom.httpTimeout.value : 3),
    auth_env: (dom.httpAuthEnv && dom.httpAuthEnv.value) ? dom.httpAuthEnv.value : "",
  };
}

export function upsertSelectedProfileFromInputs(dom, state) {
  if (!state.httpSelected) return;
  const cur = readHttpInputs(dom);
  let found = false;
  state.httpProfiles = state.httpProfiles.map(p => {
    if (p && p.name === state.httpSelected) {
      found = true;
      return { ...p, ...cur, name: state.httpSelected };
    }
    return p;
  });
  if (!found) {
    state.httpProfiles.push({ name: state.httpSelected, ...cur });
  }
}

export function applyProfileToInputs(dom, state, name) {
  const p = state.httpProfiles.find(x => x && x.name === name);
  if (!p) return;
  if (dom.httpUrl) dom.httpUrl.value = p.url || "";
  if (dom.httpToken) dom.httpToken.value = p.token || "";
  if (dom.httpTimeout) dom.httpTimeout.value = p.timeout_s ?? 3;
  if (dom.httpAuthEnv) dom.httpAuthEnv.value = p.auth_env || "";
}

export function refreshHttpProfileSelect(dom, state) {
  if (!dom.httpProfile) return;
  dom.httpProfile.innerHTML = "";
  for (const p of state.httpProfiles) {
    if (!p || typeof p !== "object") continue;
    const opt = document.createElement("option");
    opt.value = p.name || "";
    opt.textContent = p.name || "";
    dom.httpProfile.appendChild(opt);
  }
  if (state.httpSelected) dom.httpProfile.value = state.httpSelected;
  if (!dom.httpProfile.value && state.httpProfiles.length > 0) {
    state.httpSelected = state.httpProfiles[0].name || "";
    dom.httpProfile.value = state.httpSelected;
  }
}

export function countValidHttpProfiles(profiles) {
  const xs = Array.isArray(profiles) ? profiles : [];
  let score = 0;
  for (const p of xs) {
    if (!p || typeof p !== "object") continue;
    const name = String(p.name || "").trim();
    const url = String(p.url || "").trim();
    if (!name || !url) continue;
    if (!(url.startsWith("http://") || url.startsWith("https://"))) continue;
    score += 1;
  }
  return score;
}

