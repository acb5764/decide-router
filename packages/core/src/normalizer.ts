import {
  ACTION_GATE_SCHEMA,
  BEHAVIOR_SCHEMA,
  CHUNK_SCHEMA,
  type ActionSummary,
  type ChunkRef,
  type DecisionEvent,
  type DecisionRequest,
} from "./types.js";

export interface RawHarnessEvent {
  harness: "cursor" | "claude" | "proxy" | "test";
  hook:
    | "beforeShellExecution"
    | "beforeMCPExecution"
    | "preToolUse"
    | "postToolUse"
    | "preCompact"
    | "stop"
    | "tool_route";
  sessionId: string;
  goal: string;
  toolName?: string;
  command?: string;
  args?: unknown;
  recentActions?: ActionSummary[];
  contextChunks?: ChunkRef[];
  candidateTools?: string[];
  playbookNode?: string;
}

const HOOK_TO_EVENT: Record<RawHarnessEvent["hook"], DecisionEvent> = {
  beforeShellExecution: "pre_shell",
  beforeMCPExecution: "pre_mcp",
  preToolUse: "pre_tool",
  postToolUse: "post_tool",
  preCompact: "pre_compact",
  stop: "stop_check",
  tool_route: "pre_tool",
};

function previewArgs(args: unknown): string | undefined {
  if (args === undefined || args === null) return undefined;
  if (typeof args === "string") return args.slice(0, 500);
  try {
    return JSON.stringify(args).slice(0, 500);
  } catch {
    return String(args).slice(0, 500);
  }
}

/** Normalize harness-specific hooks into a typed DecisionRequest. */
export function normalizeEvent(raw: RawHarnessEvent): DecisionRequest {
  const event = HOOK_TO_EVENT[raw.hook];
  const toolName = raw.toolName ?? (raw.command ? "shell" : undefined);
  const argsPreview =
    previewArgs(raw.args) ??
    (raw.command ? raw.command.slice(0, 500) : undefined);

  let schema = ACTION_GATE_SCHEMA;
  let candidates = ["allow", "ask", "deny"];

  if (event === "pre_compact") {
    schema = CHUNK_SCHEMA;
    candidates = ["keep", "summarize", "drop"];
  } else if (event === "stop_check" || event === "post_tool") {
    schema = BEHAVIOR_SCHEMA;
    candidates = ["progressing", "stalled", "looping", "distracted"];
  } else if (raw.hook === "tool_route" && raw.candidateTools?.length) {
    candidates = [...raw.candidateTools, "none", "escalate"];
    schema = {
      heads: {
        tool_choice: candidates,
      },
    };
  }

  return {
    sessionId: raw.sessionId,
    goal: raw.goal,
    event,
    candidates,
    context: {
      recentActions: raw.recentActions ?? [],
      toolName,
      argsPreview,
      contextChunks: raw.contextChunks,
      candidateTools: raw.candidateTools,
      playbookNode: raw.playbookNode,
    },
    schema,
  };
}
