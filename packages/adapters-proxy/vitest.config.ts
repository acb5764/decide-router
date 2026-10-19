import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const alias = {
  "@decide-router/core": path.join(root, "packages/core/src/index.ts"),
  "@decide-router/backends": path.join(root, "packages/backends/src/index.ts"),
  "@decide-router/policy": path.join(root, "packages/policy/src/index.ts"),
  "@decide-router/trees": path.join(root, "packages/trees/src/index.ts"),
  "@decide-router/bootstrap": path.join(root, "packages/bootstrap/src/index.ts"),
};

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
  resolve: { alias },
});
