#!/usr/bin/env node
/**
 * Optional postToolUse — records traces for loop detection; fail-open continue.
 */
import {
  cwdOf,
  failOpen,
  readStdinJson,
  sessionIdOf,
  toolNameOf,
  writeHookResult,
} from "../hook-protocol.js";
import { authorizeHook } from "../runtime.js";

const input = await readStdinJson();
const result = await failOpen(
  async () =>
    authorizeHook({
      hook: "postToolUse",
      sessionId: sessionIdOf(input),
      toolName: toolNameOf(input) || "Unknown",
      args: input.tool_input ?? input.args,
      cwd: cwdOf(input),
    }),
  { permission: "allow" as const },
);

writeHookResult({
  continue: result.permission !== "deny",
  agent_message: result.agent_message,
});
