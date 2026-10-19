import type { DecisionTree } from "../types.js";

/** scope → diff risk → edit → verify → PR */
export const safeChangeTree: DecisionTree = {
  id: "safe-change",
  name: "Safe change",
  description: "Scoped edit with risk check, verify, then PR",
  entry: "scope",
  nodes: {
    scope: {
      id: "scope",
      title: "Scope the change",
      allowedToolClasses: ["read", "search"],
      readOnly: true,
      next: { done: "diff_risk" },
    },
    diff_risk: {
      id: "diff_risk",
      title: "Assess diff risk",
      allowedToolClasses: ["read", "search", "shell"],
      next: { low: "edit", high: "scope", abort: "stop" },
    },
    edit: {
      id: "edit",
      title: "Apply edits",
      allowedToolClasses: ["read", "search", "edit", "shell"],
      next: { done: "verify" },
    },
    verify: {
      id: "verify",
      title: "Verify (tests/lint)",
      allowedToolClasses: ["read", "shell", "search"],
      next: { pass: "pr", fail: "edit" },
    },
    pr: {
      id: "pr",
      title: "Open PR",
      allowedToolClasses: ["shell", "read", "network"],
      next: { done: "stop" },
    },
    stop: {
      id: "stop",
      title: "Stop",
      allowedToolClasses: ["read"],
      readOnly: true,
    },
  },
};
