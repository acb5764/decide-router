import { describe, expect, it } from "vitest";
import { TreeRegistry } from "./registry.js";
import { materializeBootstrappedTrees } from "./bootstrapped.js";
import { ACTION_GATE_SCHEMA, type DecisionRequest } from "@decide-router/core";

function req(toolName: string): DecisionRequest {
  return {
    sessionId: "s",
    goal: "investigate",
    event: "pre_tool",
    candidates: ["allow", "ask", "deny"],
    context: { recentActions: [], toolName },
    schema: ACTION_GATE_SCHEMA,
  };
}

describe("playbooks", () => {
  it("investigate-only denies edits until advance", () => {
    const reg = new TreeRegistry();
    const pb = reg.createPlaybook("investigate-only");
    const filtered = pb.filterCandidates(req("Write"));
    expect(filtered.candidates).toEqual(["deny"]);
    pb.advance("advance");
    const after = pb.filterCandidates(req("Write"));
    expect(after.candidates).toContain("allow");
  });

  it("safe-change starts read-only at scope", () => {
    const pb = new TreeRegistry().createPlaybook("safe-change");
    expect(pb.filterCandidates(req("Shell")).candidates).toEqual(["deny"]);
  });
});

describe("bootstrap materialize", () => {
  it("creates alignment tree from confident rules", () => {
    const trees = materializeBootstrappedTrees([
      {
        id: "r1",
        text: "Never touch production deploys",
        label: "hard_block",
        confidence: 0.9,
        sourceFile: "AGENTS.md",
      },
      {
        id: "r2",
        text: "Prefer TypeScript strict mode",
        label: "style",
        confidence: 0.8,
        sourceFile: "CONTRIBUTING.md",
      },
    ]);
    expect(trees.length).toBeGreaterThanOrEqual(1);
    expect(trees[0]?.nodes.aligned_entry?.readOnly).toBe(true);
    expect(trees[0]?.nodes.aligned_entry?.source).toBe("bootstrap");
  });
});
