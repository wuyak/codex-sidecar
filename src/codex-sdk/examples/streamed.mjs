/**
 * 官方 Streaming 风格示例：runStreamed()
 * 注意：该示例会输出结构化事件摘要，用于观察中间进度（工具调用/文件变更/最终 usage 等）。
 */

import { Codex } from "@openai/codex-sdk";

const prompt = process.argv.slice(2).join(" ").trim() || "Diagnose the test failure and propose a fix";

const codex = new Codex();
const thread = codex.startThread();
const { events } = await thread.runStreamed(prompt);

process.stdout.write(`threadId: ${thread.id}\n`);

for await (const ev of events) {
  if (!ev || typeof ev !== "object") continue;
  const t = ev.type || "";
  if (t === "thread.started") {
    process.stdout.write(`event: ${t} thread_id=${ev.thread_id}\n`);
  } else if (t === "turn.started") {
    process.stdout.write(`event: ${t}\n`);
  } else if (t === "turn.completed") {
    process.stdout.write(`event: ${t} usage=${JSON.stringify(ev.usage)}\n`);
  } else if (t === "turn.failed") {
    process.stdout.write(`event: ${t} error=${JSON.stringify(ev.error)}\n`);
  } else if (t === "item.started" || t === "item.updated" || t === "item.completed") {
    const item = ev.item || {};
    const itemType = item.type || "";
    if (itemType === "agent_message") {
      process.stdout.write(`event: ${t} item=agent_message\n`);
    } else if (itemType === "reasoning") {
      process.stdout.write(`event: ${t} item=reasoning\n`);
    } else if (itemType === "command_execution") {
      process.stdout.write(`event: ${t} item=command_execution status=${item.status || ""}\n`);
    } else if (itemType === "file_change") {
      process.stdout.write(`event: ${t} item=file_change status=${item.status || ""}\n`);
    } else if (itemType === "mcp_tool_call") {
      process.stdout.write(`event: ${t} item=mcp_tool_call status=${item.status || ""}\n`);
    } else if (itemType === "web_search") {
      process.stdout.write(`event: ${t} item=web_search\n`);
    } else if (itemType === "todo_list") {
      process.stdout.write(`event: ${t} item=todo_list\n`);
    } else if (itemType === "error") {
      process.stdout.write(`event: ${t} item=error message=${item.message || ""}\n`);
    } else {
      process.stdout.write(`event: ${t} item=${String(itemType || "unknown")}\n`);
    }
  } else if (t === "error") {
    process.stdout.write(`event: error message=${ev.message || ""}\n`);
  } else {
    process.stdout.write(`event: ${String(t || "unknown")}\n`);
  }
}

