#!/usr/bin/env node
import { claudeStop } from "../adapter.js";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const raw = Buffer.concat(chunks).toString("utf8").trim();
const input = raw
  ? (JSON.parse(raw) as { session_id?: string; cwd?: string })
  : {};

const result = await claudeStop({
  sessionId: input.session_id,
  cwd: input.cwd,
});

process.stdout.write(
  JSON.stringify({
    decision: result.block ? "block" : "approve",
    reason: result.verdict.hint ?? result.verdict.reasons.join("; "),
  }) + "\n",
);
