/**
 * 官方 Structured output 风格示例：outputSchema
 */

import { Codex } from "@openai/codex-sdk";

const prompt = process.argv.slice(2).join(" ").trim() || "Summarize repository status";

const schema = {
  type: "object",
  properties: {
    summary: { type: "string" },
    status: { type: "string", enum: ["ok", "action_required"] },
  },
  required: ["summary", "status"],
  additionalProperties: false,
};

const codex = new Codex();
const thread = codex.startThread();
const turn = await thread.run(prompt, { outputSchema: schema });

process.stdout.write(`threadId: ${thread.id}\n\n`);
process.stdout.write(turn.finalResponse + "\n");

