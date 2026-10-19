import { describe, expect, it } from "vitest";
import { DecideEngine, type DecisionBackend, type PolicyEngine } from "./engine.js";
import { normalizeEvent } from "./normalizer.js";
import { detectBehavior } from "./loop-detector.js";
import { applyToolRouting } from "./tool-routing.js";
import { applyJointConstraints, type DecisionScores } from "./types.js";
import { MemorySessionTraceStore } from "./session-store.js";

const stubBackend: DecisionBackend = {
  name: "stub",
  async score() {
    return {
      backend: "stub",
      confidence: 0.9,
      heads: {
        goal_relevance: { label: "on_goal", confidence: 0.9 },
        risk: { label: "safe", confidence: 0.9 },
        verdict: { label: "allow", confidence: 0.9 },
      },
    };
  },
};

const allowPolicy: PolicyEngine = {
  evaluate(_req, scores) {
    return {
      action: (scores.heads.verdict?.label as "allow" | "ask" | "deny") ?? "ask",
      reasons: ["policy_passthrough"],
      policyOverrides: [],
      scores,
    };
  },
};

describe("normalizeEvent", () => {
  it("maps shell hooks to pre_shell action gate", () => {
    const req = normalizeEvent({
      harness: "cursor",
      hook: "beforeShellExecution",
      sessionId: "s1",
      goal: "fix bug",
      command: "ls",
    });
    expect(req.event).toBe("pre_shell");
    expect(req.schema.heads.verdict).toContain("deny");
  });
});

describe("joint constraints", () => {
  it("forces ask when risk is destructive and verdict is allow", () => {
    const scores: DecisionScores = {
      backend: "t",
      confidence: 0.95,
      heads: {
        risk: { label: "destructive", confidence: 0.9 },
        verdict: { label: "allow", confidence: 0.95 },
      },
    };
    const next = applyJointConstraints(scores);
    expect(next.heads.verdict?.label).toBe("ask");
  });

  it("denies harmful goal relevance", () => {
    const scores: DecisionScores = {
      backend: "t",
      confidence: 0.9,
      heads: {
        goal_relevance: { label: "harmful", confidence: 0.9 },
        verdict: { label: "allow", confidence: 0.9 },
      },
    };
    expect(applyJointConstraints(scores).heads.verdict?.label).toBe("deny");
  });
});

describe("loop detector", () => {
  it("flags repeated identical calls as looping", () => {
    const actions = Array.from({ length: 5 }, () => ({
      toolName: "Shell",
      argsPreview: "rm -rf /tmp/x",
      timestamp: Date.now(),
    }));
    const f = detectBehavior(actions, { window: 12, maxRepeats: 2 });
    expect(f.label).toBe("looping");
  });
});

describe("tool routing", () => {
  it("cascade misses below threshold", () => {
    const v = applyToolRouting(
      [{ tool: "Read", score: 0.4 }],
      { mode: "cascade", top_k: 3, min_confidence: 0.65 },
    );
    expect(v.action).toBe("allow");
    expect(v.reasons).toContain("cascade_miss");
  });
});

describe("DecideEngine", () => {
  it("records traces and returns allow for safe stub", async () => {
    const store = new MemorySessionTraceStore();
    const engine = new DecideEngine({
      backend: stubBackend,
      policy: allowPolicy,
      store,
    });
    const req = normalizeEvent({
      harness: "test",
      hook: "preToolUse",
      sessionId: "sess",
      goal: "edit readme",
      toolName: "Write",
      args: { path: "README.md" },
    });
    const verdict = await engine.decide(req);
    expect(verdict.action).toBe("allow");
    const traces = await store.list("sess");
    expect(traces).toHaveLength(1);
  });

  it("fail-closes on backend error for security events", async () => {
    const bad: DecisionBackend = {
      name: "bad",
      async score() {
        throw new Error("boom");
      },
    };
    const engine = new DecideEngine({
      backend: bad,
      policy: allowPolicy,
      config: { failClosed: true },
    });
    const req = normalizeEvent({
      harness: "test",
      hook: "beforeShellExecution",
      sessionId: "s",
      goal: "x",
      command: "echo hi",
    });
    const v = await engine.decide(req);
    expect(v.action).toBe("deny");
    expect(v.policyOverrides).toContain("fail_closed");
  });
});
