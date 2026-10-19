import { describe, expect, it } from "vitest";
import { HeuristicBackend } from "./heuristic.js";
import { GlinerDecideBackend } from "./gliner.js";
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

describe("HeuristicBackend", () => {
  const backend = new HeuristicBackend();

  it("flags destructive rm -rf", async () => {
    const s = await backend.score(gate("rm -rf ./prod"));
    expect(s.heads.risk?.label).toBe("destructive");
    expect(s.heads.verdict?.label).toBe("ask");
  });

  it("allows benign ls", async () => {
    const s = await backend.score(gate("ls packages"));
    expect(s.heads.risk?.label).toBe("safe");
    expect(s.heads.verdict?.label).toBe("allow");
  });
});

describe("GlinerDecideBackend", () => {
  it("falls back to heuristic when no client", async () => {
    const backend = new GlinerDecideBackend();
    const s = await backend.score(gate("echo hi"));
    expect(s.backend).toMatch(/heuristic/);
  });

  it("uses injected client", async () => {
    const backend = new GlinerDecideBackend({
      client: {
        async classify() {
          return {
            goal_relevance: { on_goal: 0.9, tangential: 0.05, off_goal: 0.03, harmful: 0.02 },
            risk: { safe: 0.8, caution: 0.1, destructive: 0.05, privilege_escalation: 0.03, network_lateral: 0.02 },
            verdict: { allow: 0.85, ask: 0.1, deny: 0.05 },
          };
        },
      },
    });
    const s = await backend.score(gate("echo hi"));
    expect(s.backend).toBe("gliner-decide");
    expect(s.heads.verdict?.label).toBe("allow");
  });
});
