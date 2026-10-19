import type { ChunkAction, ChunkRef, DecisionScores, Verdict } from "./types.js";

export interface ContextPruneConfig {
  enabled: boolean;
  /** Never drop these kinds without an explicit rule. */
  protectedKinds?: Array<ChunkRef["kind"]>;
  /** Keep last N failing actions. */
  keepLastFailingActions?: number;
}

export const DEFAULT_CONTEXT_PRUNE: ContextPruneConfig = {
  enabled: false,
  protectedKinds: ["user_goal", "error"],
  keepLastFailingActions: 3,
};

export interface ChunkDecision {
  id: string;
  action: ChunkAction;
  confidence: number;
  reason: string;
}

/**
 * Score chunks keep|summarize|drop vs goal.
 * Never drop user goal, active error, or last N failing actions without explicit rule.
 */
export function regulateContext(
  chunks: ChunkRef[],
  chunkScores: Map<string, { action: ChunkAction; confidence: number }>,
  recentFailingActionIds: string[],
  config: ContextPruneConfig = DEFAULT_CONTEXT_PRUNE,
): ChunkDecision[] {
  const protectedKinds = new Set(
    config.protectedKinds ?? ["user_goal", "error"],
  );
  const keepFails = new Set(
    recentFailingActionIds.slice(-(config.keepLastFailingActions ?? 3)),
  );

  return chunks.map((chunk) => {
    const scored = chunkScores.get(chunk.id) ?? {
      action: "keep" as ChunkAction,
      confidence: 0.5,
    };

    if (protectedKinds.has(chunk.kind) || keepFails.has(chunk.id)) {
      if (scored.action === "drop") {
        return {
          id: chunk.id,
          action: "summarize" as ChunkAction,
          confidence: scored.confidence,
          reason: "protected_chunk_forced_summarize",
        };
      }
    }

    return {
      id: chunk.id,
      action: scored.action,
      confidence: scored.confidence,
      reason: "scored",
    };
  });
}

export function contextVerdict(
  decisions: ChunkDecision[],
  scores?: DecisionScores,
): Verdict {
  return {
    action: "rewrite",
    rewrite: {
      kind: "compact",
      payload: { chunks: decisions },
    },
    hint: "Apply structured compaction instructions",
    scores,
    reasons: ["context_regulation"],
    policyOverrides: [],
  };
}
