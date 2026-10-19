#!/usr/bin/env node
import { claudePreToolUse } from "../adapter.js";

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

const result = await claudePreToolUse({
  sessionId: input.session_id,
  toolName: input.tool_name ?? "Unknown",
  args: input.tool_input,
  command:
    typeof input.tool_input === "object" &&
    input.tool_input &&
    "command" in input.tool_input
      ? String((input.tool_input as { command: string }).command)
      : undefined,
  cwd: input.cwd,
});

process.stdout.write(
  JSON.stringify({
    permissionDecision: result.permission,
    permissionDecisionReason: result.verdict.reasons.join("; "),
  }) + "\n",
);
