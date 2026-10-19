import { existsSync, mkdirSync, readFileSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";
import type { ActionSummary } from "@decide-router/core";

export interface AuditActionRecord {
  ts: number;
  type: "action";
  sessionId: string;
  hook: string;
  toolName: string;
  argsPreview?: string;
  outcome?: ActionSummary["outcome"];
}

export interface AuditEvent {
  ts?: number;
  type?: string;
  sessionId?: string;
  hook?: string;
  toolName?: string;
  argsPreview?: string;
  outcome?: string;
  verdict?: { action?: string };
  failOpen?: boolean;
  error?: string;
  [key: string]: unknown;
}

export function resolveAuditPath(path: string, cwd: string): string {
  if (path.startsWith("~")) return path.replace(/^~/, homedir());
  if (path.startsWith("/")) return path;
  return `${cwd.replace(/\/$/, "")}/${path}`;
}

/** Append a structured action line for cross-process session reload. */
export function appendAuditLine(path: string, event: object): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify({ ts: Date.now(), ...event }) + "\n");
  } catch {
    /* best-effort */
  }
}

/**
 * Load recent tool/shell/mcp actions for a session from the JSONL audit log.
 * Cursor spawns a new Node process per hook — in-memory maps are empty on stop.
 */
export function loadRecentActionsFromAudit(
  auditPath: string,
  sessionId: string,
  limit = 50,
): ActionSummary[] {
  if (!existsSync(auditPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(auditPath, "utf8");
  } catch {
    return [];
  }

  const actions: ActionSummary[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const ev = JSON.parse(line) as AuditEvent;
      if (ev.sessionId !== sessionId) continue;

      if (ev.type === "action" && ev.toolName) {
        actions.push({
          toolName: ev.toolName,
          argsPreview: ev.argsPreview,
          outcome: (ev.outcome as ActionSummary["outcome"]) ?? "unknown",
          timestamp: ev.ts ?? Date.now(),
        });
        continue;
      }

      // Legacy / verdict lines: recover from hook + verdict when toolName present
      if (
        ev.toolName &&
        (ev.hook === "beforeShellExecution" ||
          ev.hook === "beforeMCPExecution" ||
          ev.hook === "preToolUse" ||
          ev.hook === "postToolUse")
      ) {
        actions.push({
          toolName: ev.toolName,
          argsPreview: ev.argsPreview,
          outcome:
            ev.verdict?.action === "deny"
              ? "denied"
              : ((ev.outcome as ActionSummary["outcome"]) ?? "unknown"),
          timestamp: ev.ts ?? Date.now(),
        });
      }
    } catch {
      /* skip */
    }
  }

  return actions.slice(-limit);
}
