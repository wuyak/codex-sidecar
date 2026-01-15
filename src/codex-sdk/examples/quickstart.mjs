/**
 * 官方 Quickstart 风格示例：
 * - new Codex()
 * - startThread()
 * - thread.run(prompt)
 */

import { Codex } from "@openai/codex-sdk";

const prompt = process.argv.slice(2).join(" ").trim() || "Summarize repository status";

const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run(prompt);

process.stdout.write(`threadId: ${thread.id}\n\n`);
process.stdout.write(turn.finalResponse + "\n");

