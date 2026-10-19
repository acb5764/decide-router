import { defineWorkspace } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

const alias = {
  "@decide-router/core": path.join(root, "packages/core/src/index.ts"),
  "@decide-router/backends": path.join(root, "packages/backends/src/index.ts"),
  "@decide-router/policy": path.join(root, "packages/policy/src/index.ts"),
  "@decide-router/trees": path.join(root, "packages/trees/src/index.ts"),
  "@decide-router/bootstrap": path.join(root, "packages/bootstrap/src/index.ts"),
  "@decide-router/adapters-cursor": path.join(
    root,
    "packages/adapters-cursor/src/index.ts",
  ),
  "@decide-router/adapters-claude": path.join(
    root,
    "packages/adapters-claude/src/index.ts",
  ),
  "@decide-router/adapters-proxy": path.join(
    root,
    "packages/adapters-proxy/src/index.ts",
  ),
  "@decide-router/eval": path.join(root, "packages/eval/src/index.ts"),
};

const packages = [
  "core",
  "backends",
  "policy",
  "trees",
  "bootstrap",
  "adapters-cursor",
  "adapters-claude",
  "adapters-proxy",
  "eval",
];

export default defineWorkspace(
  packages.map((name) => ({
    test: {
      name,
      root: path.join(root, `packages/${name}`),
      include: ["src/**/*.test.ts"],
    },
    resolve: { alias },
  })),
);
