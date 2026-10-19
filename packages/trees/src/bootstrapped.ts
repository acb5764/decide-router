import type { DecisionTree, TreeNode, ToolClass } from "./types.js";

/** Closed labels from bootstrap extraction. */
export type BootstrapRuleLabel =
  | "hard_block"
  | "ask_first"
  | "prefer"
  | "avoid"
  | "tool_allow"
  | "tool_deny"
  | "path_protect"
  | "network_allow"
  | "style"
  | "goal_constraint";

export interface BootstrapRuleCandidate {
  id: string;
  text: string;
  label: BootstrapRuleLabel;
  confidence: number;
  sourceFile: string;
}

export interface MaterializeOptions {
  /** Minimum confidence to emit a tree fragment. */
  minConfidence?: number;
  treeId?: string;
}

/**
 * Materialize typed playbook fragments from bootstrap rule candidates.
 * These plug into TreePlaybook — not free-text prompts.
 * Bootstrapped trees still pass through deterministic policy at runtime.
 */
export function materializeBootstrappedTrees(
  rules: BootstrapRuleCandidate[],
  opts: MaterializeOptions = {},
): DecisionTree[] {
  const min = opts.minConfidence ?? 0.72;
  const confident = rules.filter((r) => r.confidence >= min);
  if (!confident.length) return [];

  const hardBlocks = confident.filter((r) => r.label === "hard_block" || r.label === "path_protect");
  const toolDeny = confident.filter((r) => r.label === "tool_deny");
  const toolAllow = confident.filter((r) => r.label === "tool_allow");
  const askFirst = confident.filter((r) => r.label === "ask_first");
  const goal = confident.filter((r) => r.label === "goal_constraint");

  const trees: DecisionTree[] = [];

  // Alignment gate tree: start constrained, advance only after checks.
  const allowed: ToolClass[] =
    toolAllow.length > 0 ? ["read", "search"] : ["read", "search", "edit", "shell"];

  const entryNode: TreeNode = {
    id: "aligned_entry",
    title: "Bootstrap-aligned entry",
    allowedToolClasses: hardBlocks.length || toolDeny.length ? ["read", "search"] : allowed,
    readOnly: hardBlocks.length > 0 || askFirst.length > 0,
    source: "bootstrap",
    bootstrapRuleIds: confident.map((r) => r.id),
    next: { advance: "aligned_act", done: "aligned_stop" },
  };

  const actNode: TreeNode = {
    id: "aligned_act",
    title: "Act under bootstrapped constraints",
    allowedToolClasses: deriveAllowClasses(toolAllow, toolDeny),
    allowedTools: extractToolNames(toolAllow),
    source: "bootstrap",
    bootstrapRuleIds: [...toolAllow, ...toolDeny].map((r) => r.id),
    next: { done: "aligned_stop" },
  };

  const stopNode: TreeNode = {
    id: "aligned_stop",
    title: "Stop",
    allowedToolClasses: ["read"],
    readOnly: true,
    source: "bootstrap",
  };

  trees.push({
    id: opts.treeId ?? "bootstrapped-alignment",
    name: "Bootstrapped alignment",
    description: goal[0]?.text.slice(0, 200) ?? "Generated from project preference files",
    entry: "aligned_entry",
    nodes: {
      aligned_entry: entryNode,
      aligned_act: actNode,
      aligned_stop: stopNode,
    },
  });

  // Per hard_block → tiny deny-oriented investigate fragment
  for (const rule of hardBlocks.slice(0, 5)) {
    trees.push({
      id: `bootstrapped-block-${rule.id}`,
      name: `Block: ${rule.text.slice(0, 40)}`,
      description: rule.text,
      entry: "guard",
      nodes: {
        guard: {
          id: "guard",
          title: rule.text.slice(0, 80),
          allowedToolClasses: ["read", "search"],
          readOnly: true,
          source: "bootstrap",
          bootstrapRuleIds: [rule.id],
          next: { override: "unlocked" },
        },
        unlocked: {
          id: "unlocked",
          title: "Explicit override",
          allowedToolClasses: ["read", "search", "edit", "shell"],
          source: "bootstrap",
          bootstrapRuleIds: [rule.id],
        },
      },
    });
  }

  return trees;
}

function deriveAllowClasses(
  allow: BootstrapRuleCandidate[],
  deny: BootstrapRuleCandidate[],
): ToolClass[] {
  const base: ToolClass[] = ["read", "search", "edit", "shell"];
  if (deny.some((r) => /shell|bash|network|deploy/i.test(r.text))) {
    return ["read", "search", "edit"];
  }
  if (allow.length && allow.every((r) => /read|search/i.test(r.text))) {
    return ["read", "search"];
  }
  return base;
}

function extractToolNames(rules: BootstrapRuleCandidate[]): string[] | undefined {
  const names: string[] = [];
  for (const r of rules) {
    const m = r.text.match(/\b([A-Z][A-Za-z0-9_]+)\b/g);
    if (m) names.push(...m.filter((x) => !["The", "Never", "Always"].includes(x)));
  }
  return names.length ? [...new Set(names)] : undefined;
}

/** Overlay registry for generated trees (in-memory). */
export class BootstrappedOverlay {
  private trees = new Map<string, DecisionTree>();

  load(trees: DecisionTree[]): void {
    for (const t of trees) this.trees.set(t.id, t);
  }

  get(id: string): DecisionTree | undefined {
    return this.trees.get(id);
  }

  list(): DecisionTree[] {
    return [...this.trees.values()];
  }

  clear(): void {
    this.trees.clear();
  }
}
