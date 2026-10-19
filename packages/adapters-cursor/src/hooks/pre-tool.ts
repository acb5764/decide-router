#!/usr/bin/env node
import { handleHook } from "../runtime.js";
import { readStdinJson, writeResult } from "./read-stdin.js";

const input = await readStdinJson<{
  sessionId?: string;
  toolName?: string;
  args?: unknown;
  cwd?: string;
}>();

const result = await handleHook({
  hook: "preToolUse",
  sessionId: input.sessionId,
  toolName: input.toolName,
  args: input.args,
  cwd: input.cwd,
});

writeResult({
  permission: result.permission,
  userMessage: result.verdict.hint,
  rewrite: result.verdict.rewrite,
  reasons: result.verdict.reasons,
});
