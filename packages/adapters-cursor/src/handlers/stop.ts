import {
  cwdOf,
  failOpen,
  readStdinJson,
  sessionIdOf,
  writeHookResult,
  type CursorHookInput,
  type StopResult,
} from "../hook-protocol.js";
import { authorizeHook } from "../runtime.js";

/**
 * stop — interrupt looping / distracted sessions.
 * Fail open → continue (do not block stop path on errors).
 */
export async function stop(input: CursorHookInput = {}): Promise<StopResult> {
  const fallback: StopResult = { status: "continue", agent_message: undefined };
  return failOpen(async () => {
    const result = await authorizeHook({
      hook: "stop",
      sessionId: sessionIdOf(input),
      cwd: cwdOf(input),
    });
    if (result.permission === "deny") {
      return {
        status: "block",
        agent_message:
          result.agent_message ??
          "Decide-Router: stop — session appears looping or distracted; replan.",
      };
    }
    return {
      status: "continue",
      agent_message: result.agent_message,
    };
  }, fallback);
}

export async function main(): Promise<void> {
  const input = await readStdinJson();
  writeHookResult(await stop(input));
}
