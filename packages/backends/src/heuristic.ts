import type {
  DecisionBackend,
  DecisionRequest,
  DecisionScores,
  HeadScore,
} from "@decide-router/core";

/**
 * Offline heuristic backend — always available, no model deps.
 * Uses keyword / pattern heuristics aligned with action-gate heads.
 */
export class HeuristicBackend implements DecisionBackend {
  readonly name = "heuristic";

  async score(request: DecisionRequest): Promise<DecisionScores> {
    const text = [
      request.goal,
      request.context.toolName ?? "",
      request.context.argsPreview ?? "",
    ]
      .join("\n")
      .toLowerCase();

    const heads: Record<string, HeadScore> = {};

    for (const [head, labels] of Object.entries(request.schema.heads)) {
      if (head === "goal_relevance") {
        heads[head] = scoreRelevance(text, request.goal, labels);
      } else if (head === "risk") {
        heads[head] = scoreRisk(text, labels);
      } else if (head === "verdict") {
        // Filled after other heads
        heads[head] = { label: "allow", confidence: 0.5 };
      } else if (head === "behavior") {
        heads[head] = { label: "progressing", confidence: 0.55 };
      } else if (head === "chunk_action") {
        heads[head] = scoreChunk(text, labels);
      } else if (head === "tool_choice") {
        heads[head] = scoreToolChoice(request, labels);
      } else if (head === "rule_label") {
        heads[head] = scoreRuleLabel(text, labels);
      } else {
        heads[head] = {
          label: labels[0] ?? "none",
          confidence: 0.4,
          distribution: Object.fromEntries(labels.map((l) => [l, l === labels[0] ? 0.4 : 0.1])),
        };
      }
    }

    // Joint-ish verdict from relevance + risk
    if (heads.verdict && heads.risk && heads.goal_relevance) {
      heads.verdict = deriveVerdict(heads.goal_relevance, heads.risk);
    }

    const confidence =
      average(
        Object.values(heads).map((h) => h.confidence),
      ) || 0.5;

    return { backend: this.name, confidence, heads };
  }
}

function scoreRelevance(
  text: string,
  goal: string,
  labels: string[],
): HeadScore {
  const harmful =
    /exfil|ransomware|steal\s+cred|wipe\s+disk|backdoor/i.test(text);
  if (harmful && labels.includes("harmful")) {
    return dist("harmful", labels, 0.92);
  }
  const goalTokens = tokenize(goal);
  const overlap = goalTokens.filter((t) => text.includes(t)).length;
  const ratio = goalTokens.length ? overlap / goalTokens.length : 0.5;
  if (ratio >= 0.35 && labels.includes("on_goal")) {
    return dist("on_goal", labels, 0.55 + ratio * 0.35);
  }
  if (ratio >= 0.15 && labels.includes("tangential")) {
    return dist("tangential", labels, 0.6);
  }
  if (labels.includes("off_goal")) return dist("off_goal", labels, 0.65);
  return dist(labels[0]!, labels, 0.4);
}

function scoreRisk(text: string, labels: string[]): HeadScore {
  if (
    /rm\s+-rf|delete.*prod|drop\s+table|chmod\s+777|curl.*\|\s*sh/i.test(text) &&
    labels.includes("destructive")
  ) {
    return dist("destructive", labels, 0.93);
  }
  if (
    /iam|permission|\*|sudo|chmod|chown|deploy.?key|administrator/i.test(text) &&
    labels.includes("privilege_escalation")
  ) {
    return dist("privilege_escalation", labels, 0.85);
  }
  if (
    /nmap|port.?scan|ssrf|169\.254|lateral/i.test(text) &&
    labels.includes("network_lateral")
  ) {
    return dist("network_lateral", labels, 0.88);
  }
  if (/curl|wget|http|chmod|chown|rm |delete|force/i.test(text) && labels.includes("caution")) {
    return dist("caution", labels, 0.7);
  }
  if (labels.includes("safe")) return dist("safe", labels, 0.75);
  return dist(labels[0]!, labels, 0.5);
}

function deriveVerdict(
  relevance: HeadScore,
  risk: HeadScore,
): HeadScore {
  if (relevance.label === "harmful") return distLabel("deny", 0.95);
  if (
    risk.label === "destructive" ||
    risk.label === "privilege_escalation" ||
    risk.label === "network_lateral"
  ) {
    return distLabel("ask", 0.9);
  }
  if (relevance.label === "off_goal") return distLabel("ask", 0.7);
  if (risk.label === "caution") return distLabel("ask", 0.65);
  return distLabel("allow", 0.8);
}

function scoreChunk(text: string, labels: string[]): HeadScore {
  if (/goal|error|fail/i.test(text) && labels.includes("keep")) {
    return dist("keep", labels, 0.85);
  }
  if (/readme|changelog|license/i.test(text) && labels.includes("summarize")) {
    return dist("summarize", labels, 0.7);
  }
  if (/noise|duplicate|old\s+log/i.test(text) && labels.includes("drop")) {
    return dist("drop", labels, 0.75);
  }
  return dist("keep", labels, 0.55);
}

function scoreToolChoice(request: DecisionRequest, labels: string[]): HeadScore {
  const goal = request.goal.toLowerCase();
  const scored = labels.map((tool) => {
    const t = tool.toLowerCase();
    let s = 0.2;
    if (t === "none" || t === "escalate") s = 0.15;
    if (/read|grep|search/.test(t) && /find|where|inspect|read/.test(goal)) s = 0.7;
    if (/edit|write|patch/.test(t) && /fix|change|implement|add/.test(goal)) s = 0.75;
    if (/shell|bash/.test(t) && /run|test|build|install/.test(goal)) s = 0.7;
    return [tool, s] as const;
  });
  scored.sort((a, b) => b[1] - a[1]);
  const best = scored[0]!;
  return {
    label: best[0],
    confidence: best[1],
    distribution: Object.fromEntries(scored),
  };
}

/** Bootstrap rule classification head. */
function scoreRuleLabel(text: string, labels: string[]): HeadScore {
  const rules: Array<[string, RegExp]> = [
    ["hard_block", /\b(never|must not|forbidden|do not|don't|hard.?block|deny)\b/i],
    ["ask_first", /\b(ask|confirm|approval|human.?in.?loop)\b/i],
    ["path_protect", /\b(prod|\.env|secret|terraform\.tfstate|protect(ed)?\s+path)\b/i],
    ["network_allow", /\b(allowlist|allow\s+host|network\s+allow|egress)\b/i],
    ["tool_deny", /\b(deny\s+tool|disallow\s+tool|ban\s+tool)\b/i],
    ["tool_allow", /\b(allow\s+tool|only\s+use|tool\s+allow)\b/i],
    ["avoid", /\b(avoid|prefer not|discourage)\b/i],
    ["prefer", /\b(prefer|should|recommended)\b/i],
    ["goal_constraint", /\b(goal|must\s+ship|scope|out of scope)\b/i],
    ["style", /\b(style|format|lint|naming|typescript|indent)\b/i],
  ];
  for (const [label, re] of rules) {
    if (labels.includes(label) && re.test(text)) {
      return dist(label, labels, 0.8);
    }
  }
  const fallback = labels.includes("prefer") ? "prefer" : labels[0]!;
  return dist(fallback, labels, 0.45);
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function dist(label: string, labels: string[], conf: number): HeadScore {
  const distribution: Record<string, number> = {};
  const rest = (1 - conf) / Math.max(1, labels.length - 1);
  for (const l of labels) distribution[l] = l === label ? conf : rest;
  return { label, confidence: conf, distribution };
}

function distLabel(label: string, conf: number): HeadScore {
  return {
    label,
    confidence: conf,
    distribution: { allow: label === "allow" ? conf : 0.1, ask: label === "ask" ? conf : 0.1, deny: label === "deny" ? conf : 0.1 },
  };
}

function average(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
