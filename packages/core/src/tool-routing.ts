import type {
  DecisionCompleteness,
  DecisionScores,
  ToolRoutingMode,
  Verdict,
} from "./types.js";

export interface ToolRoutingConfig {
  mode: ToolRoutingMode;
  top_k: number;
  min_confidence: number;
  /** Max scoring/routing attempts per session window (budget). */
  max_attempts?: number;
}

export const DEFAULT_TOOL_ROUTING: ToolRoutingConfig = {
  mode: "cascade",
  top_k: 3,
  min_confidence: 0.65,
  max_attempts: 32,
};

export interface ToolScore {
  tool: string;
  score: number;
}

export interface ToolRoutingContext {
  /** Attempts already used in this session/window. */
  attemptsUsed?: number;
}

/**
 * Apply tool-routing mode to scored candidates.
 * - replace: force top tool
 * - cascade: only replace when confidence >= threshold; else leave to LLM with
 *   explicit cascade_miss completeness (never silent certainty)
 * - assist: attach ranked hint, leave choice to LLM
 * - guard: only deny disallowed; do not pick
 * - trigger: fire when score clears threshold (side-effect style)
 */
export function applyToolRouting(
  ranked: ToolScore[],
  config: ToolRoutingConfig,
  allowed?: Set<string>,
  ctx: ToolRoutingContext = {},
): Verdict {
  const limit = config.max_attempts ?? 32;
  const used = ctx.attemptsUsed ?? 0;
  if (used >= limit) {
    return {
      action: "ask",
      hint: "Tool-routing budget exhausted; escalate to LLM. Incomplete — do not treat as authorization.",
      reasons: ["routing_budget_exhausted"],
      policyOverrides: [],
      completeness: "budget_exhausted",
      budget: { used, limit, kind: "routing" },
    };
  }

  const filtered = allowed
    ? ranked.filter(
        (t) =>
          allowed.has(t.tool) || t.tool === "none" || t.tool === "escalate",
      )
    : ranked;
  const top = filtered.slice(0, config.top_k);
  const best = top[0];
  const budget = { used: used + 1, limit, kind: "routing" as const };

  if (!best) {
    return {
      action: "ask",
      hint: "No tool candidates scored; escalate to LLM. Incomplete discovery.",
      reasons: ["empty_tool_scores"],
      policyOverrides: [],
      completeness: "incomplete",
      budget,
    };
  }

  const probs = Object.fromEntries(top.map((t) => [t.tool, t.score]));

  switch (config.mode) {
    case "replace":
      return withComplete(
        {
          action: "rewrite",
          rewrite: {
            kind: "force_tool",
            payload: { tool: best.tool, ranked: top },
          },
          hint: `Use tool ${best.tool}`,
          reasons: [`replace:${best.tool}`],
          policyOverrides: [],
          probabilities: probs,
          budget,
        },
        "complete",
      );
    case "cascade":
      if (best.score >= config.min_confidence && best.tool !== "escalate") {
        return withComplete(
          {
            action: "rewrite",
            rewrite: {
              kind: "force_tool",
              payload: { tool: best.tool, ranked: top },
            },
            hint: `High-confidence tool: ${best.tool}`,
            reasons: [`cascade_hit:${best.tool}`],
            policyOverrides: [],
            probabilities: probs,
            budget,
          },
          "complete",
        );
      }
      // Honest miss — LLM chooses; never silent allow of risk
      return {
        action: "ask",
        hint: `Cascade miss (best=${best.tool}@${best.score.toFixed(2)}); incomplete confidence — LLM or human chooses. Not an authorization.`,
        reasons: ["cascade_miss"],
        policyOverrides: [],
        probabilities: probs,
        completeness: "cascade_miss",
        budget,
      };
    case "assist":
      return {
        action: "allow",
        hint: `Suggested tools: ${top.map((t) => t.tool).join(", ")} (assist — estimate only)`,
        rewrite: { kind: "hint", payload: { ranked: top } },
        reasons: ["assist"],
        policyOverrides: [],
        probabilities: probs,
        completeness: "incomplete",
        budget,
      };
    case "guard":
      return withComplete(
        {
          action: "allow",
          reasons: ["guard_passthrough"],
          policyOverrides: [],
          probabilities: probs,
          budget,
        },
        "complete",
      );
    case "trigger":
      if (best.score >= config.min_confidence) {
        return withComplete(
          {
            action: "rewrite",
            rewrite: {
              kind: "force_tool",
              payload: { tool: best.tool, trigger: true },
            },
            hint: `Triggered ${best.tool}`,
            reasons: [`trigger:${best.tool}`],
            policyOverrides: [],
            budget,
          },
          "complete",
        );
      }
      return {
        action: "ask",
        reasons: ["trigger_below_threshold"],
        policyOverrides: [],
        completeness: "incomplete",
        budget,
      };
    default:
      return {
        action: "ask",
        reasons: ["unknown_routing_mode"],
        policyOverrides: [],
        completeness: "incomplete",
        budget,
      };
  }
}

function withComplete(
  verdict: Verdict,
  completeness: DecisionCompleteness,
): Verdict {
  return { ...verdict, completeness };
}

export function scoresToToolRanking(scores: DecisionScores): ToolScore[] {
  const head = scores.heads.tool_choice;
  if (!head?.distribution) {
    return [{ tool: head?.label ?? "none", score: head?.confidence ?? 0 }];
  }
  return Object.entries(head.distribution)
    .map(([tool, score]) => ({ tool, score }))
    .sort((a, b) => b.score - a.score);
}
