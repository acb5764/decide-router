import {
  commandOf,
  cwdOf,
  failOpen,
  readStdinJson,
  sessionIdOf,
  writeHookResult,
  type AuthHookResult,
  type CursorHookInput,
} from "../hook-protocol.js";
import { authorizeHook } from "../runtime.js";

/**
 * beforeShellExecution — authorize shell commands before they run.
 * Fail open on Decide-Router errors; policy denials still block when evaluated.
 */
export async function beforeShellExecution(
  input: CursorHookInput = {},
): Promise<AuthHookResult> {
  return failOpen(
    async () => {
      const command =
        commandOf(input) ??
        (typeof input.tool_input?.command === "string"
          ? input.tool_input.command
          : undefined) ??
        "";
      return authorizeHook({
        hook: "beforeShellExecution",
        sessionId: sessionIdOf(input),
        toolName: "Shell",
        command,
        args: input.tool_input ?? { command },
        cwd: cwdOf(input),
      });
    },
    { permission: "allow", reasons: ["fail_open"] },
  );
}

export async function main(): Promise<void> {
  const input = await readStdinJson();
  const result = await beforeShellExecution(input);
  writeHookResult({
    permission: result.permission,
    user_message: result.user_message,
    agent_message: result.agent_message,
  });
}
