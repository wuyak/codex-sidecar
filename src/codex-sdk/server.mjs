/**
 * Codex SDK 本地控制台（HTTP + Web UI）
 *
 * 目标：
 * - 不改动仓库现有 UI 目录（保持纯净）
 * - 在浏览器里输入 → 通过 Codex SDK 驱动本机 Codex 执行
 * - 支持 threadId 续聊（UI localStorage 记忆）
 *
 * 安全：
 * - 默认仅允许 loopback 绑定
 * - POST 需要 X-CSRF-Token（从 /api/status 获取；同源页面内使用）
 */

import http from "http";
import crypto from "crypto";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { Codex } from "@openai/codex-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");

const HOST = String(process.env.HOST || "127.0.0.1");
const PORT = Number.parseInt(String(process.env.PORT || "8790"), 10);
const ALLOW_REMOTE = String(process.env.CODEX_SDK_ALLOW_REMOTE || "").trim() === "1";
const CSRF_TOKEN = crypto.randomBytes(16).toString("hex");

function isLoopbackHost(host) {
  const h = String(host || "").trim().toLowerCase();
  return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
}

if (!isLoopbackHost(HOST) && !ALLOW_REMOTE) {
  // eslint-disable-next-line no-console
  console.error(
    `[codex-sdk] 拒绝绑定到非本机地址: HOST=${HOST}. 如确需对外开放，请设置 CODEX_SDK_ALLOW_REMOTE=1（强烈不建议）。`,
  );
  process.exit(2);
}

const codex = new Codex();
const locks = new Map(); // threadId -> Promise

function json(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Content-Length": String(body.length),
  });
  res.end(body);
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  const data = Buffer.from(String(body || ""), "utf8");
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store, max-age=0",
    Pragma: "no-cache",
    "Content-Length": String(data.length),
  });
  res.end(data);
}

function contentTypeFor(p) {
  const ext = String(path.extname(p) || "").toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function safeWebPath(urlPath) {
  const raw = String(urlPath || "");
  const clean = raw.replace(/\?.*$/, "").replace(/#.*$/, "");
  const rel = clean.replace(/^\/+/, "");
  // Only serve from /ui/* or / (redirect)
  if (!rel.startsWith("ui/") && rel !== "ui" && rel !== "") return null;
  let fileRel = rel;
  if (fileRel === "" || fileRel === "ui") fileRel = "ui/index.html";
  if (fileRel.endsWith("/")) fileRel += "index.html";
  // Map /ui/... to WEB_DIR/...
  fileRel = fileRel.replace(/^ui\//, "");
  const abs = path.resolve(path.join(WEB_DIR, fileRel));
  const root = path.resolve(WEB_DIR);
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

async function readJsonBody(req, limitBytes = 1_000_000) {
  return await new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      n += chunk.length;
      if (n > limitBytes) {
        reject(new Error("body_too_large"));
        try { req.destroy(); } catch (_) {}
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8").trim();
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error("invalid_json"));
      }
    });
    req.on("error", reject);
  });
}

function toBool(value, fallback) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function normalizeThreadOptions(threadOptions) {
  if (!isObject(threadOptions)) return {};
  const out = {};
  if (typeof threadOptions.model === "string") out.model = threadOptions.model;
  if (typeof threadOptions.sandboxMode === "string") out.sandboxMode = threadOptions.sandboxMode;
  if (typeof threadOptions.workingDirectory === "string") out.workingDirectory = threadOptions.workingDirectory;
  if (threadOptions.skipGitRepoCheck !== undefined) out.skipGitRepoCheck = toBool(threadOptions.skipGitRepoCheck, false);
  if (typeof threadOptions.modelReasoningEffort === "string") out.modelReasoningEffort = threadOptions.modelReasoningEffort;
  if (threadOptions.networkAccessEnabled !== undefined) out.networkAccessEnabled = toBool(threadOptions.networkAccessEnabled, undefined);
  if (threadOptions.webSearchEnabled !== undefined) out.webSearchEnabled = toBool(threadOptions.webSearchEnabled, undefined);
  if (typeof threadOptions.approvalPolicy === "string") out.approvalPolicy = threadOptions.approvalPolicy;
  if (Array.isArray(threadOptions.additionalDirectories)) {
    out.additionalDirectories = threadOptions.additionalDirectories.filter((x) => typeof x === "string");
  }
  return out;
}

async function enqueue(threadId, fn) {
  const key = String(threadId || "").trim();
  if (!key) return await fn();
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(key, next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  }));
  return await next;
}

async function handleTurnRun(req, res) {
  const got = String(req.headers["x-csrf-token"] || "").trim();
  if (!got || got !== CSRF_TOKEN) {
    json(res, 403, { ok: false, error: "bad_csrf" });
    return;
  }

  const ct = String(req.headers["content-type"] || "").toLowerCase();
  if (!ct.includes("application/json")) {
    json(res, 400, { ok: false, error: "content_type_must_be_json" });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    json(res, 400, { ok: false, error: String(e && e.message ? e.message : "invalid_json") });
    return;
  }

  const textIn = String((body && (body.text ?? body.input)) || "").trim();
  const threadId = String((body && (body.threadId ?? body.thread_id ?? body.thread)) || "").trim();
  const threadOptions = normalizeThreadOptions(body && body.threadOptions);

  if (!textIn) {
    json(res, 400, { ok: false, error: "empty_text" });
    return;
  }

  try {
    const result = await enqueue(threadId, async () => {
      const thread = threadId ? codex.resumeThread(threadId, threadOptions) : codex.startThread(threadOptions);
      const turn = await thread.run(textIn);
      const newId = String(thread.id || threadId || "").trim();
      return {
        ok: true,
        threadId: newId,
        finalResponse: String((turn && turn.finalResponse) || ""),
        usage: turn && turn.usage ? turn.usage : null,
        items: turn && Array.isArray(turn.items) ? turn.items : [],
      };
    });
    json(res, 200, result);
  } catch (e) {
    const msg = (e && typeof e === "object" && "message" in e) ? String(e.message || "error") : String(e || "error");
    json(res, 502, { ok: false, error: msg });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    const p = url.pathname || "/";

    if (p === "/health") {
      json(res, 200, { ok: true });
      return;
    }

    if (p === "/api/status") {
      json(res, 200, {
        ok: true,
        csrf_token: CSRF_TOKEN,
        host: HOST,
        port: PORT,
        node: process.version,
        codex_home: String(process.env.CODEX_HOME || "").trim(),
      });
      return;
    }

    if (p === "/api/turn/run" && String(req.method || "").toUpperCase() === "POST") {
      await handleTurnRun(req, res);
      return;
    }

    if (p === "/") {
      res.writeHead(302, { Location: "/ui" });
      res.end();
      return;
    }

    const abs = safeWebPath(p);
    if (!abs) {
      json(res, 404, { ok: false, error: "not_found" });
      return;
    }
    if (!existsSync(abs)) {
      json(res, 404, { ok: false, error: "not_found" });
      return;
    }
    const body = await readFile(abs);
    res.writeHead(200, {
      "Content-Type": contentTypeFor(abs),
      "Cache-Control": "no-store, max-age=0",
      Pragma: "no-cache",
      "Content-Length": String(body.length),
    });
    res.end(body);
  } catch (e) {
    text(res, 500, "internal_error");
  }
});

server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`[codex-sdk] 控制台已启动: http://${HOST}:${PORT}/ui`);
});

