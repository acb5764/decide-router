import type { DecisionTree } from "../types.js";

/** reproduce → isolate → patch → test → stop */
export const bugfixTree: DecisionTree = {
  id: "bugfix",
  name: "Bugfix",
  description: "Reproduce, isolate, patch, test, stop",
  entry: "reproduce",
  nodes: {
    reproduce: {
      id: "reproduce",
      title: "Reproduce the bug",
      allowedToolClasses: ["read", "search", "shell"],
      next: { reproduced: "isolate", blocked: "stop" },
    },
    isolate: {
      id: "isolate",
      title: "Isolate root cause",
      allowedToolClasses: ["read", "search", "shell"],
      next: { found: "patch", need_more: "reproduce" },
    },
    patch: {
      id: "patch",
      title: "Apply patch",
      allowedToolClasses: ["read", "search", "edit", "shell"],
      next: { done: "test" },
    },
    test: {
      id: "test",
      title: "Run tests",
      allowedToolClasses: ["shell", "read"],
      next: { pass: "stop", fail: "patch" },
    },
    stop: {
      id: "stop",
      title: "Stop",
      allowedToolClasses: ["read"],
      readOnly: true,
    },
  },
};
