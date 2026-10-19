import { randomUUID } from "node:crypto";
import {
  applyJointConstraints,
  type DecisionRequest,
  type DecisionScores,
  type SessionTraceEntry,
  type Verdict,
  type VerdictAction,
} from "./types.js";
import {
  behaviorToHeadScore,
  detectBehavior,
  type LoopDetectorConfig,
  DEFAULT_LOOP_CONFIG,
} from "./loop-detector.js";
import {
  applyToolRouting,
  scoresToToolRanking,
  type ToolRoutingConfig,
  DEFAULT_TOOL_ROUTING,
} from "./tool-routing.js";
import {
  contextVerdict,
  regulateContext,
  type ContextPruneConfig,
  DEFAULT_CONTEXT_PRUNE,
} from "./context-regulation.js";
import type { SessionTraceStore } from "./session-store.js";
import { MemorySessionTraceStore } from "./session-store.js";

/** Pluggable scorer — implemented in @decide-router/backends. */
export interface DecisionBackend {
  readonly name: string;
  score(request: DecisionRequest): Promise<DecisionScores>;
}

/** Deterministic policy overlay — implemented in @decide-router/policy. */
export interface PolicyEngine {
  evaluate(request: DecisionRequest, scores: DecisionScores): Verdict;
}

/** Optional playbook constraint — implemented in @decide-router/trees. */
export interface PlaybookConstraint {
  filterCandidates(request: DecisionRequest): DecisionRequest;
  nodeId?: string;
}

export interface EngineConfig {
  actionGateMinConfidence?: number;
  midCascade?: boolean;
  loopDetector?: LoopDetectorConfig;
  toolRouting?: ToolRoutingConfig;
  contextPrune?: ContextPruneConfig;
  failClosed?: boolean;
}

export interface DecideEngineOptions {
  backend: DecisionBackend;
  policy: PolicyEngine;
  store?: SessionTraceStore;
  playbook?: PlaybookConstraint;
  config?: EngineConfig;
}

/**
 * Pipeline: ingress request → (trees filter) → scorer → joint constraints → policy.
 * Model scores never alone authorize destructive actions — policy always runs.
 */
export class DecideEngine {
  private readonly backend: DecisionBackend;
  private readonly policy: PolicyEngine;
  private readonly store: SessionTraceStore;
  private readonly playbook?: PlaybookConstraint;
  private readonly config: Required<
    Pick<EngineConfig, "actionGateMinConfidence" | "midCascade" | "failClosed">
  > & {
    loopDetector: LoopDetectorConfig;
    toolRouting: ToolRoutingConfig;
    contextPrune: ContextPruneConfig;
  };

  constructor(opts: DecideEngineOptions) {
    this.backend = opts.backend;
    this.policy = opts.policy;
    this.store = opts.store ?? new MemorySessionTraceStore();
    this.playbook = opts.playbook;
    this.config = {
      actionGateMinConfidence: opts.config?.actionGateMinConfidence ?? 0.72,
      midCascade: opts.config?.midCascade ?? true,
      failClosed: opts.config?.failClosed ?? true,
      loopDetector: opts.config?.loopDetector ?? DEFAULT_LOOP_CONFIG,
      toolRouting: opts.config?.toolRouting ?? DEFAULT_TOOL_ROUTING,
      contextPrune: opts.config?.contextPrune ?? DEFAULT_CONTEXT_PRUNE,
    };
  }

  async decide(request: DecisionRequest): Promise<Verdict> {
    let req = this.playbook
      ? this.playbook.filterCandidates(request)
      : request;

    let scores: DecisionScores;
    try {
      scores = await this.backend.score(req);
    } catch (err) {
      if (this.config.failClosed && isSecurityEvent(req.event)) {
        return this.finish(req, undefined, {
          action: "deny",
          reasons: [
            `backend_error_fail_closed:${err instanceof Error ? err.message : String(err)}`,
          ],
          policyOverrides: ["fail_closed"],
        });
      }
      // Fail open when not fail-closed: handler/backend did not complete — do not pretend mid-confidence ask.
      return this.finish(req, undefined, {
        action: "allow",
        reasons: [
          `backend_error_fail_open:${err instanceof Error ? err.message : String(err)}`,
        ],
        policyOverrides: [],
        completeness: "incomplete",
        hint: "Decide-Router backend unavailable — fail open (allow).",
      });
    }

    // Behavior head from traces for stop/post and as overlay on action gates.
    if (
      req.event === "stop_check" ||
      req.event === "post_tool" ||
      req.event === "pre_tool" ||
      req.event === "pre_shell" ||
      req.event === "pre_mcp"
    ) {
      const features = detectBehavior(
        req.context.recentActions,
        this.config.loopDetector,
      );
      scores = {
        ...scores,
        heads: {
          ...scores.heads,
          behavior: behaviorToHeadScore(features),
        },
      };
    }

    if (req.schema.heads.goal_relevance || req.schema.heads.risk) {
      scores = applyJointConstraints(scores);
    }

    // Tool routing path
    if (req.context.candidateTools?.length && scores.heads.tool_choice) {
      const ranked = scoresToToolRanking(scores);
      const routed = applyToolRouting(
        ranked,
        this.config.toolRouting,
        this.playbook
          ? new Set(req.candidates)
          : undefined,
      );
      const policyVerdict = this.policy.evaluate(req, scores);
      return this.finish(
        req,
        scores,
        mergePolicyOverRouting(policyVerdict, routed),
      );
    }

    // Context regulation
    if (req.event === "pre_compact" && this.config.contextPrune.enabled) {
      const chunks = req.context.contextChunks ?? [];
      const chunkScores = new Map<
        string,
        { action: "keep" | "summarize" | "drop"; confidence: number }
      >();
      for (const c of chunks) {
        const head = scores.heads[`chunk:${c.id}`] ?? scores.heads.chunk_action;
        chunkScores.set(c.id, {
          action: (head?.label as "keep" | "summarize" | "drop") ?? "keep",
          confidence: head?.confidence ?? 0.5,
        });
      }
      const failing = req.context.recentActions
        .filter((a) => a.outcome === "error")
        .map((_, i) => `fail-${i}`);
      const decisions = regulateContext(
        chunks,
        chunkScores,
        failing,
        this.config.contextPrune,
      );
      const v = contextVerdict(decisions, scores);
      const policyVerdict = this.policy.evaluate(req, scores);
      if (policyVerdict.action === "deny") {
        return this.finish(req, scores, policyVerdict);
      }
      return this.finish(req, scores, v);
    }

    // Loop/distraction → deny + replan hint
    const behavior = scores.heads.behavior?.label;
    if (behavior === "looping" || behavior === "distracted") {
      const base = this.policy.evaluate(req, scores);
      if (base.action !== "deny") {
        return this.finish(req, scores, {
          action: "deny",
          hint: "Stop and replan: session appears looping or distracted.",
          scores,
          reasons: [`behavior:${behavior}`, ...base.reasons],
          policyOverrides: ["behavior_interrupt", ...base.policyOverrides],
        });
      }
    }

    let verdict = this.policy.evaluate(req, scores);

    // Confidence gates
    const conf = scores.confidence;
    if (
      verdict.action === "allow" &&
      conf < this.config.actionGateMinConfidence
    ) {
      if (this.config.midCascade) {
        verdict = {
          ...verdict,
          action: "ask",
          hint:
            verdict.hint ??
            "Mid confidence — cascade to LLM for final judgment. Incomplete; not an authorization.",
          reasons: [...verdict.reasons, "below_min_confidence"],
          completeness: "cascade_miss",
        };
      }
    }

    if (!verdict.completeness) {
      verdict = {
        ...verdict,
        completeness: verdict.action === "ask" ? "incomplete" : "complete",
      };
    }

    return this.finish(req, scores, { ...verdict, scores });
  }

  private async finish(
    request: DecisionRequest,
    scores: DecisionScores | undefined,
    verdict: Verdict,
  ): Promise<Verdict> {
    const entry: SessionTraceEntry = {
      id: randomUUID(),
      sessionId: request.sessionId,
      timestamp: Date.now(),
      request,
      scores,
      verdict,
    };
    await this.store.append(entry);
    return verdict;
  }
}

function isSecurityEvent(event: DecisionRequest["event"]): boolean {
  return event === "pre_shell" || event === "pre_mcp" || event === "pre_tool";
}

function mergePolicyOverRouting(policy: Verdict, routed: Verdict): Verdict {
  // Deterministic policy always wins over model/routing scores.
  if (policy.action === "deny" || policy.action === "ask") {
    return {
      ...policy,
      hint: routed.hint ?? policy.hint,
      reasons: [...policy.reasons, ...routed.reasons],
      policyOverrides: [
        ...policy.policyOverrides,
        "policy_over_routing",
      ],
    };
  }
  return {
    ...routed,
    policyOverrides: [
      ...routed.policyOverrides,
      ...policy.policyOverrides,
    ],
    reasons: [...routed.reasons, ...policy.reasons],
  };
}

export function scoresToVerdictAction(scores: DecisionScores): VerdictAction {
  const v = scores.heads.verdict?.label;
  if (v === "allow" || v === "ask" || v === "deny") return v;
  return "ask";
}
