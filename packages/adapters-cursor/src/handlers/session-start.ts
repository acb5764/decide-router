import {
  cwdOf,
  failOpen,
  readStdinJson,
  writeHookResult,
  type CursorHookInput,
  type SessionStartResult,
} from "../hook-protocol.js";
import { loadCursorConfig, runBootstrapForSession } from "../runtime.js";

/**
 * sessionStart — bootstrap alignment + inject authorization guidance.
 * Always fail-open: never block session creation.
 */
export async function sessionStart(
  input: CursorHookInput = {},
): Promise<SessionStartResult> {
  return failOpen(async () => {
    const cwd = cwdOf(input);
    const cfg = loadCursorConfig(cwd);
    let bootstrapNote = "";
    try {
      const artifact = await runBootstrapForSession(cwd);
      if (artifact) {
        bootstrapNote = ` Loaded playbooks: ${artifact.trees.map((t) => t.id).join(", ") || "none"}.`;
      }
    } catch {
      bootstrapNote = " Bootstrap skipped (fail open).";
    }

    const lines = [
      "Decide-Router hooks are active for this session and authorize shell/MCP/tool use (fail open on errors).",
      `Goal: ${cfg.goal}`,
      "Gates: beforeShellExecution, beforeMCPExecution, preToolUse, stop, preCompact.",
      "Judgment ≠ permission — deterministic policy may deny destructive actions; model scores alone never authorize them.",
      bootstrapNote.trim(),
    ].filter(Boolean);

    return { additional_context: lines.join(" ") };
  }, { additional_context: "Decide-Router sessionStart fail-open." });
}

/** Hook entrypoint */
export async function main(): Promise<void> {
  const input = await readStdinJson();
  writeHookResult(await sessionStart(input));
}
