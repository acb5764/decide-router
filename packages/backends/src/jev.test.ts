import { describe, expect, it } from "vitest";
import {
  JevBackend,
  buildJevEvaluationRequest,
  probabilitiesToHeads,
  GUIDANCE,
} from "./jev.js";
import { FallbackBackend } from "./fallback.js";
import { HeuristicBackend } from "./heuristic.js";
import { ACTION_GATE_SCHEMA, type DecisionRequest } from "@decide-router/core";

function gate(argsPreview: string): DecisionRequest {
  return {
    sessionId: "s",
    goal: "Ship Decide-Router MVP",
    event: "pre_shell",
    candidates: ["allow", "ask", "deny"],
    context: { recentActions: [], toolName: "shell", argsPreview },
    schema: ACTION_GATE_SCHEMA,
  };
}

describe("jev criteria protocol", () => {
  it("puts criteria in state and questions only apply them", () => {
    const req = buildJevEvaluationRequest({
      goal: "fix bug",
      event: "pre_shell",
      toolName: "shell",
      argsPreview: "ls",
      heads: ACTION_GATE_SCHEMA.heads,
    });
    expect(req.state.guidance).toBe(GUIDANCE);
    expect(req.state.criteria["risk:destructive"]).toMatch(/destroy/i);
    expect(req.questions["risk:destructive"]?.type).toBe("boolean");
    expect(req.questions["risk:destructive"]?.instructions).toMatch(
      /Apply state\.criteria/,
    );
  });

  it("maps boolean probabilities to head winners", () => {
    const { heads, confidence } = probabilitiesToHeads(
      {
        "goal_relevance:on_goal": 0.8,
        "goal_relevance:tangential": 0.1,
        "goal_relevance:off_goal": 0.05,
        "goal_relevance:harmful": 0.05,
        "risk:safe": 0.7,
        "risk:caution": 0.2,
        "risk:destructive": 0.05,
        "risk:privilege_escalation": 0.03,
        "risk:network_lateral": 0.02,
        "verdict:allow": 0.75,
        "verdict:ask": 0.2,
        "verdict:deny": 0.05,
      },
      ACTION_GATE_SCHEMA.heads,
    );
    expect(heads.goal_relevance?.label).toBe("on_goal");
    expect(heads.risk?.label).toBe("safe");
    expect(heads.verdict?.label).toBe("allow");
    expect(confidence).toBeGreaterThan(0.5);
  });
});

describe("JevBackend", () => {
  it("scores via evaluate client", async () => {
    const backend = new JevBackend({
      async evaluate(req) {
        const out: Record<string, number> = {};
        for (const key of Object.keys(req.questions)) {
          out[key] = key.endsWith(":safe") || key.endsWith(":on_goal") || key.endsWith(":allow")
            ? 0.85
            : 0.05;
        }
        return out;
      },
    });
    const s = await backend.score(gate("echo hi"));
    expect(s.backend).toBe("jev");
    expect(s.heads.verdict?.label).toBe("allow");
  });

  it("falls back through FallbackBackend when Jev throws", async () => {
    const backend = new FallbackBackend(
      new JevBackend({
        async evaluate() {
          throw new Error("offline");
        },
      }),
      new HeuristicBackend(),
    );
    const s = await backend.score(gate("ls"));
    expect(s.backend).toMatch(/heuristic/);
  });
});
