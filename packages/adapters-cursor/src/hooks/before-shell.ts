#!/usr/bin/env node
import { handleHook } from "../runtime.js";
import { readStdinJson, writeResult } from "./read-stdin.js";

const input = await readStdinJson<{
  sessionId?: string;
  command?: string;
  cwd?: string;
}>();

const result = await handleHook({
  hook: "beforeShellExecution",
  sessionId: input.sessionId,
  command: input.command,
  cwd: input.cwd,
});

writeResult({
  permission: result.permission,
  userMessage: result.verdict.hint,
  agentMessage: result.verdict.hint,
  reasons: result.verdict.reasons,
});
