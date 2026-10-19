import { describe, expect, it } from "vitest";
import { handleHook } from "./runtime.js";

describe("cursor adapter", () => {
  it("denies dangerous shell via shared core", async () => {
    const result = await handleHook({
      hook: "beforeShellExecution",
      sessionId: "t1",
      command: "chmod 777 /tmp/x",
      cwd: process.cwd(),
    });
    expect(result.permission).toBe("deny");
  });
});
