import type { DecisionRequest, PlaybookConstraint } from "@decide-router/core";

export type ToolClass =
  | "read"
  | "search"
  | "edit"
  | "shell"
  | "network"
  | "mcp"
  | "deploy"
  | "any";

export interface TreeNode {
  id: string;
  title: string;
  /** Allowed tool classes at this node — shrinks Decide option set. */
  allowedToolClasses: ToolClass[];
  /** Explicit tool name allowlist (optional, intersects classes). */
  allowedTools?: string[];
  /** Advance edges keyed by outcome label. */
  next?: Record<string, string>;
  /** If true, edits/shell/network are denied until advanced. */
  readOnly?: boolean;
  /** Metadata from bootstrap extraction. */
  source?: "builtin" | "bootstrap";
  bootstrapRuleIds?: string[];
}

export interface DecisionTree {
  id: string;
  name: string;
  description: string;
  entry: string;
  nodes: Record<string, TreeNode>;
}

export interface PlaybookRuntimeState {
  treeId: string;
  nodeId: string;
}

const CLASS_PATTERNS: Record<ToolClass, RegExp> = {
  read: /read|cat|get|open|show/i,
  search: /grep|search|glob|find|rg/i,
  edit: /edit|write|apply|patch|strreplace|create/i,
  shell: /shell|bash|terminal|exec/i,
  network: /curl|fetch|http|mcp|web/i,
  mcp: /mcp/i,
  deploy: /deploy|kubectl|terraform|apply.?infra/i,
  any: /.*/,
};

export function toolMatchesClass(toolName: string, cls: ToolClass): boolean {
  if (cls === "any") return true;
  return CLASS_PATTERNS[cls].test(toolName);
}

export class TreePlaybook implements PlaybookConstraint {
  nodeId: string;

  constructor(
    private readonly tree: DecisionTree,
    startNode?: string,
  ) {
    this.nodeId = startNode ?? tree.entry;
  }

  get node(): TreeNode {
    const n = this.tree.nodes[this.nodeId];
    if (!n) throw new Error(`Unknown node ${this.nodeId} in tree ${this.tree.id}`);
    return n;
  }

  advance(outcome: string): boolean {
    const next = this.node.next?.[outcome];
    if (!next) return false;
    if (!this.tree.nodes[next]) return false;
    this.nodeId = next;
    return true;
  }

  filterCandidates(request: DecisionRequest): DecisionRequest {
    const node = this.node;
    const tool = request.context.toolName;

    let candidates = [...request.candidates];
    if (node.allowedTools?.length) {
      // For tool routing candidates
      if (request.context.candidateTools) {
        const allowed = new Set(node.allowedTools);
        const filtered = request.context.candidateTools.filter((t) =>
          allowed.has(t),
        );
        return {
          ...request,
          candidates: [...filtered, "none", "escalate"],
          context: {
            ...request.context,
            candidateTools: filtered,
            playbookNode: node.id,
          },
        };
      }
    }

    if (tool && node.readOnly) {
      const isWrite =
        toolMatchesClass(tool, "edit") ||
        toolMatchesClass(tool, "shell") ||
        toolMatchesClass(tool, "deploy") ||
        toolMatchesClass(tool, "network");
      if (isWrite) {
        candidates = ["deny"];
      }
    }

    if (tool && !node.allowedToolClasses.includes("any")) {
      const ok = node.allowedToolClasses.some((c) => toolMatchesClass(tool, c));
      if (!ok) {
        candidates = ["deny"];
      }
    }

    return {
      ...request,
      candidates,
      context: { ...request.context, playbookNode: node.id },
    };
  }
}
