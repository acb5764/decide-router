import {
  commandOf,
  cwdOf,
  failOpen,
  readStdinJson,
  sessionIdOf,
  toolNameOf,
  writeHookResult,
  type AuthHookResult,
  type CursorHookInput,
} from "../hook-protocol.js";
import { authorizeHook } from "../runtime.js";

/**
 * preToolUse — authorize tool invocations (Write/Delete/Shell/…).
 * Fail open on errors; deterministic policy may still deny when it runs.
 */
export async function preToolUse(
  input: CursorHookInput = {},
): Promise<AuthHookResult> {
  return failOpen(async () => {
    const tool = toolNameOf(input) || "Unknown";
    const isShell = /shell|bash|terminal/i.test(tool) || Boolean(commandOf(input));
    return authorizeHook({
      hook: isShell ? "beforeShellExecution" : "preToolUse",
      sessionId: sessionIdOf(input),
      toolName: tool,
      command: commandOf(input),
      args: input.tool_input ?? input.args,
      cwd: cwdOf(input),
    });
  }, { permission: "allow", reasons: ["fail_open"] });
}

export async function main(): Promise<void> {
  const input = await readStdinJson();
  const result = await preToolUse(input);
  writeHookResult({
    permission: result.permission,
    user_message: result.user_message,
    agent_message: result.agent_message,
    ...(result.updated_input ? { updated_input: result.updated_input } : {}),
  });
}
