/** Closed option sets — every decision uses explicit labels only. */

export type DecisionEvent =
  | "pre_tool"
  | "pre_shell"
  | "pre_mcp"
  | "pre_compact"
  | "post_tool"
  | "stop_check";

export type GoalRelevance = "on_goal" | "tangential" | "off_goal" | "harmful";
export type RiskLevel =
  | "safe"
  | "caution"
  | "destructive"
  | "privilege_escalation"
  | "network_lateral";
export type VerdictLabel = "allow" | "ask" | "deny";
export type BehaviorLabel = "progressing" | "stalled" | "looping" | "distracted";
export type ChunkAction = "keep" | "summarize" | "drop";

export type ToolRoutingMode =
  | "replace"
  | "cascade"
  | "assist"
  | "guard"
  | "trigger";

export type VerdictAction = "allow" | "deny" | "ask" | "rewrite";

export interface ActionSummary {
  toolName: string;
  argsPreview?: string;
  outcome?: "ok" | "error" | "denied" | "unknown";
  timestamp: number;
}

export interface ChunkRef {
  id: string;
  source: string;
  preview: string;
  tokensApprox?: number;
  kind?: "user_goal" | "error" | "action" | "file" | "other";
}

export interface MultiHeadSchema {
  heads: Record<string, string[]>;
}

export interface DecisionContext {
  recentActions: ActionSummary[];
  toolName?: string;
  argsPreview?: string;
  contextChunks?: ChunkRef[];
  candidateTools?: string[];
  playbookNode?: string;
}

export interface DecisionRequest {
  sessionId: string;
  goal: string;
  event: DecisionEvent;
  candidates: string[];
  context: DecisionContext;
  schema: MultiHeadSchema;
}

export interface HeadScore {
  label: string;
  confidence: number;
  distribution?: Record<string, number>;
}

export interface DecisionScores {
  heads: Record<string, HeadScore>;
  /** Overall confidence for the primary judgment. */
  confidence: number;
  backend: string;
}

export interface Verdict {
  action: VerdictAction;
  /** When rewrite: structured instruction for the harness. */
  rewrite?: {
    kind: "summarize" | "strip_args" | "force_tool" | "compact" | "hint";
    payload?: unknown;
  };
  hint?: string;
  scores?: DecisionScores;
  reasons: string[];
  policyOverrides: string[];
  /** Probability vector for logging / threshold fitting. */
  probabilities?: Record<string, number>;
}

export interface SessionTraceEntry {
  id: string;
  sessionId: string;
  timestamp: number;
  request: DecisionRequest;
  scores?: DecisionScores;
  verdict: Verdict;
}

export const ACTION_GATE_SCHEMA: MultiHeadSchema = {
  heads: {
    goal_relevance: ["on_goal", "tangential", "off_goal", "harmful"],
    risk: [
      "safe",
      "caution",
      "destructive",
      "privilege_escalation",
      "network_lateral",
    ],
    verdict: ["allow", "ask", "deny"],
  },
};

export const BEHAVIOR_SCHEMA: MultiHeadSchema = {
  heads: {
    behavior: ["progressing", "stalled", "looping", "distracted"],
  },
};

export const CHUNK_SCHEMA: MultiHeadSchema = {
  heads: {
    chunk_action: ["keep", "summarize", "drop"],
  },
};

/** Joint constraints: destructive risk never allows without ask. */
export function applyJointConstraints(
  scores: DecisionScores,
): DecisionScores {
  const risk = scores.heads.risk?.label as RiskLevel | undefined;
  const verdict = scores.heads.verdict;
  if (!verdict) return scores;

  const next = { ...scores, heads: { ...scores.heads } };
  if (
    (risk === "destructive" ||
      risk === "privilege_escalation" ||
      risk === "network_lateral") &&
    verdict.label === "allow"
  ) {
    next.heads.verdict = {
      ...verdict,
      label: "ask",
      confidence: Math.min(verdict.confidence, 0.99),
    };
  }

  const relevance = scores.heads.goal_relevance?.label as
    | GoalRelevance
    | undefined;
  if (relevance === "harmful" && next.heads.verdict?.label !== "deny") {
    next.heads.verdict = {
      label: "deny",
      confidence: Math.max(next.heads.verdict?.confidence ?? 0.9, 0.9),
    };
  }

  return next;
}
