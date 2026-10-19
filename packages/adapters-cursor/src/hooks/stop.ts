#!/usr/bin/env node
import { handleHook } from "../runtime.js";
import { readStdinJson, writeResult } from "./read-stdin.js";

const input = await readStdinJson<{
  sessionId?: string;
  cwd?: string;
}>();

const result = await handleHook({
  hook: "stop",
  sessionId: input.sessionId,
  cwd: input.cwd,
});

writeResult({
  status: result.permission === "deny" ? "block" : "continue",
  agentMessage: result.verdict.hint,
  reasons: result.verdict.reasons,
});
