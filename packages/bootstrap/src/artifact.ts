import type { BootstrapRuleCandidate } from "@decide-router/trees";
import type { DecisionTree } from "@decide-router/trees";

export interface BootstrapArtifact {
  generatedAt: string;
  root: string;
  rules: BootstrapRuleCandidate[];
  trees: DecisionTree[];
  /** Short checklist the host agent follows. */
  agentInstruction: string;
  policyOverlayHints: {
    protected_paths: string[];
    tool_deny: string[];
    network_allow: string[];
  };
}

export function buildAgentInstruction(
  root: string,
  treeIds: string[],
  ruleCount: number,
): string {
  return [
    "# Decide-Router bootstrap checklist",
    "",
    "Before acting on this project:",
    `1. Read preference sources under \`${root}\` (AGENTS.md, CLAUDE.md, .cursor/rules/**, preferences.md, CONTRIBUTING.md, decide-router.config.*).`,
    "2. Call `decide-router bootstrap [path]` (or the sessionStart/init hook) so rules are classified into closed labels.",
    `3. Load generated playbook trees before tool use: ${treeIds.length ? treeIds.map((id) => `\`${id}\``).join(", ") : "(none above confidence gate)"}.`,
    "4. Remember: judgment ≠ permission — bootstrapped trees still pass through deterministic policy; model scores never alone authorize destructive actions.",
    `5. ${ruleCount} rule candidate(s) were extracted this run; prefer hard_block / path_protect / tool_deny overlays.`,
    "",
  ].join("\n");
}

export function policyHintsFromRules(rules: BootstrapRuleCandidate[]): BootstrapArtifact["policyOverlayHints"] {
  const protected_paths: string[] = [];
  const tool_deny: string[] = [];
  const network_allow: string[] = [];

  for (const r of rules) {
    if (r.label === "path_protect" || r.label === "hard_block") {
      const m = r.text.match(/`([^`]+)`|"([^"]+)"|(\*\*\/[^\s]+)/);
      const path = m?.[1] ?? m?.[2] ?? m?.[3];
      if (path) protected_paths.push(path);
      else if (/prod/i.test(r.text)) protected_paths.push("**/prod/**");
      if (/\.env/i.test(r.text)) protected_paths.push("**/.env*");
    }
    if (r.label === "tool_deny") {
      const tools = r.text.match(/\b([A-Z][A-Za-z0-9_]+)\b/g) ?? [];
      tool_deny.push(...tools.filter((t) => t.length > 2));
    }
    if (r.label === "network_allow") {
      const hosts = r.text.match(/\b([a-z0-9.-]+\.[a-z]{2,})\b/gi) ?? [];
      network_allow.push(...hosts);
    }
  }

  return {
    protected_paths: [...new Set(protected_paths)],
    tool_deny: [...new Set(tool_deny)],
    network_allow: [...new Set(network_allow)],
  };
}
