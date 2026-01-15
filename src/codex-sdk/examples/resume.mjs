/**
 * 官方 Resuming thread 风格示例：resumeThread(threadId)
 */

import { Codex } from "@openai/codex-sdk";

const threadId = (process.argv[2] || process.env.CODEX_THREAD_ID || "").trim();
if (!threadId) {
  process.stderr.write("Usage: npm run resume -- <threadId> [prompt]\n");
  process.stderr.write("   or: CODEX_THREAD_ID=<threadId> npm run resume\n");
  process.exit(2);
}

const prompt = process.argv.slice(3).join(" ").trim() || "Implement the fix";

const codex = new Codex();
const thread = codex.resumeThread(threadId);
const turn = await thread.run(prompt);

process.stdout.write(`threadId: ${thread.id}\n\n`);
process.stdout.write(turn.finalResponse + "\n");

