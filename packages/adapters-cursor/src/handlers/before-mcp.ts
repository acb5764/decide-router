import {
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
 * beforeMCPExecution — authorize MCP tool calls before execution.
 * Fail open on errors.
 */
export async function beforeMCPExecution(
  input: CursorHookInput = {},
): Promise<AuthHookResult> {
  return failOpen(
    async () =>
      authorizeHook({
        hook: "beforeMCPExecution",
        sessionId: sessionIdOf(input),
        toolName: toolNameOf(input) || "mcp",
        args: input.tool_input ?? input.args,
        cwd: cwdOf(input),
      }),
    { permission: "allow", reasons: ["fail_open"] },
  );
}

export async function main(): Promise<void> {
  const input = await readStdinJson();
  const result = await beforeMCPExecution(input);
  writeHookResult({
    permission: result.permission,
    user_message: result.user_message,
    agent_message: result.agent_message,
  });
}
