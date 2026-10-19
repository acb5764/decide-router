import type { DecisionTree } from "../types.js";

/** Read-only until tree advances past investigate. */
export const investigateOnlyTree: DecisionTree = {
  id: "investigate-only",
  name: "Investigate only",
  description: "Read-only tools enforced until explicitly advanced",
  entry: "investigate",
  nodes: {
    investigate: {
      id: "investigate",
      title: "Investigate (read-only)",
      allowedToolClasses: ["read", "search"],
      readOnly: true,
      next: { advance: "act", done: "stop" },
    },
    act: {
      id: "act",
      title: "Act (unlocked)",
      allowedToolClasses: ["read", "search", "edit", "shell"],
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
