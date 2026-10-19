#!/usr/bin/env node
import { claudeSessionStart } from "../adapter.js";

const chunks: Buffer[] = [];
for await (const c of process.stdin) chunks.push(c as Buffer);
const raw = Buffer.concat(chunks).toString("utf8").trim();
const input = raw ? (JSON.parse(raw) as { cwd?: string }) : {};

const result = await claudeSessionStart(input.cwd ?? process.cwd());
process.stdout.write(
  JSON.stringify({
    continue: true,
    systemMessage: result.agentInstruction,
    trees: result.trees,
  }) + "\n",
);
