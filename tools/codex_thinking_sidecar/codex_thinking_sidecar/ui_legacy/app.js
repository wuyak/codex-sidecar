import { initApp } from "./app/main.js";

initApp().catch((e) => {
  try { console.error("[sidecar-ui] init failed", e); } catch (_) {}
});

