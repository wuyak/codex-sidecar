export async function api(method, url, body) {
  const opts = { method, cache: "no-store", headers: { "Content-Type": "application/json; charset=utf-8" } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const resp = await fetch(url, opts);
  return await resp.json();
}

export async function healthPid() {
  try {
    const r = await fetch(`/health?t=${Date.now()}`, { cache: "no-store" });
    if (!r || !r.ok) return null;
    const j = await r.json();
    const p = Number(j && j.pid);
    return Number.isFinite(p) ? p : null;
  } catch (_) {
    return null;
  }
}

export async function waitForRestartCycle(beforePid) {
  const deadline = Date.now() + 15000;
  let sawDown = false;
  let afterPid = null;

  // Give restart a moment to actually begin.
  await new Promise((res) => setTimeout(res, 180));
  while (Date.now() < deadline) {
    const p = await healthPid();
    if (p !== null) {
      afterPid = p;
      // Ideal: new PID.
      if (beforePid && p !== beforePid) break;
      // If we don't know the old PID, any healthy response is enough.
      if (!beforePid) break;
      // If PID didn't change but we observed downtime, assume in-place restart happened.
      if (beforePid && p === beforePid && sawDown) break;
    } else {
      sawDown = true;
    }
    await new Promise((res) => setTimeout(res, 140));
  }
  return { beforePid: beforePid || null, afterPid, sawDown };
}

