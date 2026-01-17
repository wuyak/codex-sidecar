import type {
  ApiConfigResponse,
  ApiMessagesResponse,
  ApiOkResponse,
  ApiStatusResponse,
  ApiThreadsResponse,
  ApiTranslatorsResponse,
} from "./types";

async function _json<T>(resp: Response): Promise<T> {
  return (await resp.json()) as T;
}

async function _api<T>(method: "GET" | "POST", path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = {};
  const init: RequestInit = { method, headers, cache: "no-store", signal };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const sep = path.includes("?") ? "&" : "?";
  const resp = await fetch(`${path}${sep}t=${Date.now()}`, init);
  if (!resp.ok) {
    let err = "";
    try {
      const obj = await _json<Record<string, unknown>>(resp);
      err = String(obj.error || "");
    } catch (_) {
      err = "";
    }
    throw new Error(err ? `http_status=${resp.status} error=${err}` : `http_status=${resp.status}`);
  }
  return await _json<T>(resp);
}

export const api = {
  getConfig: async (signal?: AbortSignal) => await _api<ApiConfigResponse>("GET", "/api/config", undefined, signal),
  saveConfig: async (patch: Record<string, unknown>, signal?: AbortSignal) =>
    await _api<ApiConfigResponse>("POST", "/api/config", patch, signal),
  recoverConfig: async (signal?: AbortSignal) => await _api<ApiConfigResponse>("POST", "/api/config/recover", {}, signal),

  getStatus: async (signal?: AbortSignal) => await _api<ApiStatusResponse>("GET", "/api/status", undefined, signal),
  getTranslators: async (signal?: AbortSignal) =>
    await _api<ApiTranslatorsResponse>("GET", "/api/translators", undefined, signal),

  getThreads: async (signal?: AbortSignal) => await _api<ApiThreadsResponse>("GET", "/api/threads", undefined, signal),

  getMessages: async (threadId?: string, signal?: AbortSignal) => {
    const p = threadId ? `/api/messages?thread_id=${encodeURIComponent(threadId)}` : "/api/messages";
    return await _api<ApiMessagesResponse>("GET", p, undefined, signal);
  },

  start: async () => await _api<ApiOkResponse>("POST", "/api/control/start", {}),
  stop: async () => await _api<ApiOkResponse>("POST", "/api/control/stop", {}),
  restartProcess: async () => await _api<ApiOkResponse>("POST", "/api/control/restart_process", {}),
  clear: async () => await _api<ApiOkResponse>("POST", "/api/control/clear", {}),
  shutdown: async () => await _api<ApiOkResponse>("POST", "/api/control/shutdown", {}),
  followAuto: async () => await _api<ApiOkResponse>("POST", "/api/control/follow", { mode: "auto" }),
  followPin: async (threadId: string, file: string) =>
    await _api<ApiOkResponse>("POST", "/api/control/follow", { mode: "pin", thread_id: threadId, file }),
};
