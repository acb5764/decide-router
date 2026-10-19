import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  cwdOf,
  failOpen,
  readStdinJson,
  writeHookResult,
  type CursorHookInput,
  type SessionStartResult,
} from "../hook-protocol.js";
import {
  dataDir,
  handlersDistReady,
  loadCursorConfig,
  runBootstrapForSession,
} from "../runtime.js";

/**
 * sessionStart — bootstrap when sources change + inject guidance.
 * Always fail-open: never block session creation.
 * Does not claim hooks are active when handlers dist is missing.
 */
export async function sessionStart(
  input: CursorHookInput = {},
): Promise<SessionStartResult> {
  return failOpen(async () => {
    const cwd = cwdOf(input);
    const cfg = loadCursorConfig(cwd);
    const ready =
      handlersDistReady(dataDir()) ||
      existsSync(
        join(
          process.env.DECIDE_ROUTER_ROOT ?? "",
          "dist",
          "handlers",
          "session-start.js",
        ),
      );

    let bootstrapNote = "";
    try {
      const artifact = await runBootstrapForSession(cwd);
      if (artifact) {
        bootstrapNote = ` Playbooks: ${artifact.trees.map((t) => t.id).join(", ") || "none"}.`;
      }
    } catch {
      bootstrapNote = " Bootstrap skipped (fail open).";
    }

    const lines = ready
      ? [
          "Decide-Router authorization handlers are available for this session (fail open on crashes).",
          `Goal: ${cfg.goal}`,
          "Gates: beforeShellExecution, beforeMCPExecution, preToolUse (file edits), stop.",
          "Judgment ≠ permission — deterministic policy may deny destructive actions; model scores alone never authorize them.",
          bootstrapNote.trim(),
        ]
      : [
          "Decide-Router handlers dist is not installed — hooks fail open (allow). Run a user install after `pnpm build` to enable authorization.",
          `Goal: ${cfg.goal}`,
          bootstrapNote.trim(),
        ];

    return { additional_context: lines.filter(Boolean).join(" ") };
  }, {
    additional_context:
      "Decide-Router sessionStart fail-open (handlers unavailable).",
  });
}

/** Hook entrypoint */
export async function main(): Promise<void> {
  const input = await readStdinJson();
  writeHookResult(await sessionStart(input));
}
