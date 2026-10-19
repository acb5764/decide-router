#!/usr/bin/env node
import { claudePostToolUse } from "../adapter.js";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const raw = Buffer.concat(chunks).toString("utf8").trim();
const input = raw
  ? (JSON.parse(raw) as {
      session_id?: string;
      tool_name?: string;
      tool_input?: unknown;
      cwd?: string;
    })
  : {};

const result = await claudePostToolUse({
  sessionId: input.session_id,
  toolName: input.tool_name ?? "Unknown",
  args: input.tool_input,
  cwd: input.cwd,
});

process.stdout.write(
  JSON.stringify({
    continue: result.continue,
    systemMessage: result.verdict.hint,
  }) + "\n",
);
