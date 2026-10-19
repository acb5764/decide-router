import { safeChangeTree } from "./playbooks/safe-change.js";
import { bugfixTree } from "./playbooks/bugfix.js";
import { investigateOnlyTree } from "./playbooks/investigate-only.js";
import type { DecisionTree } from "./types.js";
import { TreePlaybook } from "./types.js";
import { BootstrappedOverlay } from "./bootstrapped.js";

const BUILTIN: Record<string, DecisionTree> = {
  [safeChangeTree.id]: safeChangeTree,
  [bugfixTree.id]: bugfixTree,
  [investigateOnlyTree.id]: investigateOnlyTree,
};

export class TreeRegistry {
  readonly overlay = new BootstrappedOverlay();

  get(id: string): DecisionTree | undefined {
    return this.overlay.get(id) ?? BUILTIN[id];
  }

  list(): DecisionTree[] {
    const map = new Map<string, DecisionTree>(Object.entries(BUILTIN));
    for (const t of this.overlay.list()) map.set(t.id, t);
    return [...map.values()];
  }

  createPlaybook(id: string, startNode?: string): TreePlaybook {
    const tree = this.get(id);
    if (!tree) throw new Error(`Unknown playbook: ${id}`);
    return new TreePlaybook(tree, startNode);
  }
}

export { BUILTIN as builtinTrees };
