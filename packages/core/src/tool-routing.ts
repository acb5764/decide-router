import type { DecisionScores, ToolRoutingMode, Verdict } from "./types.js";

export interface ToolRoutingConfig {
  mode: ToolRoutingMode;
  top_k: number;
  min_confidence: number;
}

export const DEFAULT_TOOL_ROUTING: ToolRoutingConfig = {
  mode: "cascade",
  top_k: 3,
  min_confidence: 0.65,
};

export interface ToolScore {
  tool: string;
  score: number;
}

/**
 * Apply tool-routing mode to scored candidates.
 * - replace: force top tool
 * - cascade: only replace when confidence >= threshold; else leave to LLM
 * - assist: attach ranked hint, leave choice to LLM
 * - guard: only deny disallowed; do not pick
 * - trigger: fire when score clears threshold (side-effect style)
 */
export function applyToolRouting(
  ranked: ToolScore[],
  config: ToolRoutingConfig,
  allowed?: Set<string>,
): Verdict {
  const filtered = allowed
    ? ranked.filter((t) => allowed.has(t.tool) || t.tool === "none" || t.tool === "escalate")
    : ranked;
  const top = filtered.slice(0, config.top_k);
  const best = top[0];

  if (!best) {
    return {
      action: "ask",
      hint: "No tool candidates scored; escalate to LLM.",
      reasons: ["empty_tool_scores"],
      policyOverrides: [],
    };
  }

  switch (config.mode) {
    case "replace":
      return {
        action: "rewrite",
        rewrite: { kind: "force_tool", payload: { tool: best.tool, ranked: top } },
        hint: `Use tool ${best.tool}`,
        reasons: [`replace:${best.tool}`],
        policyOverrides: [],
        probabilities: Object.fromEntries(top.map((t) => [t.tool, t.score])),
      };
    case "cascade":
      if (best.score >= config.min_confidence && best.tool !== "escalate") {
        return {
          action: "rewrite",
          rewrite: { kind: "force_tool", payload: { tool: best.tool, ranked: top } },
          hint: `High-confidence tool: ${best.tool}`,
          reasons: [`cascade_hit:${best.tool}`],
          policyOverrides: [],
          probabilities: Object.fromEntries(top.map((t) => [t.tool, t.score])),
        };
      }
      return {
        action: "allow",
        hint: `Cascade miss (best=${best.tool}@${best.score.toFixed(2)}); LLM chooses.`,
        reasons: ["cascade_miss"],
        policyOverrides: [],
        probabilities: Object.fromEntries(top.map((t) => [t.tool, t.score])),
      };
    case "assist":
      return {
        action: "allow",
        hint: `Suggested tools: ${top.map((t) => t.tool).join(", ")}`,
        rewrite: { kind: "hint", payload: { ranked: top } },
        reasons: ["assist"],
        policyOverrides: [],
        probabilities: Object.fromEntries(top.map((t) => [t.tool, t.score])),
      };
    case "guard":
      return {
        action: "allow",
        reasons: ["guard_passthrough"],
        policyOverrides: [],
        probabilities: Object.fromEntries(top.map((t) => [t.tool, t.score])),
      };
    case "trigger":
      if (best.score >= config.min_confidence) {
        return {
          action: "rewrite",
          rewrite: { kind: "force_tool", payload: { tool: best.tool, trigger: true } },
          hint: `Triggered ${best.tool}`,
          reasons: [`trigger:${best.tool}`],
          policyOverrides: [],
        };
      }
      return {
        action: "allow",
        reasons: ["trigger_below_threshold"],
        policyOverrides: [],
      };
    default:
      return {
        action: "ask",
        reasons: ["unknown_routing_mode"],
        policyOverrides: [],
      };
  }
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
