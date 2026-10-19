import {
  cwdOf,
  failOpen,
  readStdinJson,
  sessionIdOf,
  writeHookResult,
  type CursorHookInput,
  type PreCompactResult,
} from "../hook-protocol.js";
import { authorizeHook } from "../runtime.js";

/**
 * preCompact — score chunks keep|summarize|drop; advisory to the host.
 * Fail open → empty result (host continues default compaction).
 */
export async function preCompact(
  input: CursorHookInput = {},
): Promise<PreCompactResult> {
  const fallback: PreCompactResult = {
    user_message: undefined,
    compact: undefined,
  };
  return failOpen(async () => {
    const chunks = (input.chunks ?? []).map((c) => ({
      id: c.id,
      source: c.source,
      preview: c.preview,
      kind:
        (c.kind as "user_goal" | "error" | "action" | "file" | "other") ??
        "other",
    }));

    const result = await authorizeHook({
      hook: "preCompact",
      sessionId: sessionIdOf(input),
      contextChunks: chunks,
      cwd: cwdOf(input),
    });

    const verdict = result.verdict as
      | { rewrite?: { payload?: unknown } }
      | undefined;
    const compact = verdict?.rewrite?.payload;
    return {
      user_message:
        result.agent_message ??
        (compact
          ? "Decide-Router compaction advice recorded (host may not rewrite summarizer)."
          : undefined),
      compact,
    };
  }, fallback);
}

export async function main(): Promise<void> {
  const input = await readStdinJson();
  writeHookResult(await preCompact(input));
}
