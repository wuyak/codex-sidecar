/**
 * Codex SDK 单次 turn 执行器（stdin JSON -> stdout JSON）。
 *
 * 设计目标：
 * - 不常驻端口：由上层服务按需 spawn，避免多进程常驻与跨域复杂度
 * - 支持 threadId 续聊：与 Codex CLI 的 sessions 机制对齐
 */

import { Codex } from "@openai/codex-sdk";

function readStdinUtf8() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toBool(value, fallback) {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  if (value === false || value === "false" || value === 0 || value === "0") return false;
  return fallback;
}

function normalizeThreadOptions(threadOptions) {
  if (!isObject(threadOptions)) return {};
  const out = {};
  if (typeof threadOptions.model === "string") out.model = threadOptions.model;
  if (typeof threadOptions.sandboxMode === "string") out.sandboxMode = threadOptions.sandboxMode;
  if (typeof threadOptions.workingDirectory === "string") out.workingDirectory = threadOptions.workingDirectory;
  if (threadOptions.skipGitRepoCheck !== undefined) {
    out.skipGitRepoCheck = toBool(threadOptions.skipGitRepoCheck, false);
  }
  if (typeof threadOptions.modelReasoningEffort === "string") {
    out.modelReasoningEffort = threadOptions.modelReasoningEffort;
  }
  if (threadOptions.networkAccessEnabled !== undefined) {
    out.networkAccessEnabled = toBool(threadOptions.networkAccessEnabled, undefined);
  }
  if (threadOptions.webSearchEnabled !== undefined) {
    out.webSearchEnabled = toBool(threadOptions.webSearchEnabled, undefined);
  }
  if (typeof threadOptions.approvalPolicy === "string") out.approvalPolicy = threadOptions.approvalPolicy;
  if (Array.isArray(threadOptions.additionalDirectories)) {
    out.additionalDirectories = threadOptions.additionalDirectories.filter((x) => typeof x === "string");
  }
  return out;
}

function normalizeInput(input) {
  // SDK 支持 string 或 UserInput[]
  if (typeof input === "string") return input;
  if (!Array.isArray(input)) return "";
  const out = [];
  for (const item of input) {
    if (!isObject(item)) continue;
    if (item.type === "text" && typeof item.text === "string") out.push({ type: "text", text: item.text });
    if (item.type === "local_image" && typeof item.path === "string") out.push({ type: "local_image", path: item.path });
  }
  return out;
}

async function main() {
  const raw = (await readStdinUtf8()).trim();
  let req = {};
  try {
    req = raw ? JSON.parse(raw) : {};
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: "invalid_json" }) + "\n");
    process.exitCode = 2;
    return;
  }

  const codexHome = (typeof req.codexHome === "string" && req.codexHome.trim()) ? req.codexHome.trim() : "";
  const threadId = (typeof req.threadId === "string" && req.threadId.trim()) ? req.threadId.trim() : "";
  const input = normalizeInput(req.input);
  const threadOptions = normalizeThreadOptions(req.threadOptions);

  if ((typeof input === "string" && !input.trim()) || (Array.isArray(input) && input.length === 0)) {
    process.stdout.write(JSON.stringify({ ok: false, error: "empty_input" }) + "\n");
    process.exitCode = 2;
    return;
  }

  try {
    if (codexHome) {
      process.env.CODEX_HOME = codexHome;
    }
    const codex = new Codex();
    const thread = threadId ? codex.resumeThread(threadId, threadOptions) : codex.startThread(threadOptions);
    const turn = await thread.run(input);
    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          threadId: thread.id,
          turn: {
            finalResponse: turn.finalResponse,
            items: turn.items,
            usage: turn.usage,
          },
        },
        null,
        0,
      ) + "\n",
    );
  } catch (e) {
    const msg = (e && typeof e === "object" && "message" in e) ? String(e.message || "error") : String(e || "error");
    process.stdout.write(JSON.stringify({ ok: false, error: msg }) + "\n");
    process.exitCode = 1;
  }
}

await main();
