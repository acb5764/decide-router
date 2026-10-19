import { describe, expect, it } from "vitest";
import { beforeShellExecution } from "./handlers/before-shell.js";
import { beforeMCPExecution } from "./handlers/before-mcp.js";
import { preToolUse } from "./handlers/pre-tool.js";
import { stop } from "./handlers/stop.js";
import { preCompact } from "./handlers/pre-compact.js";
import { sessionStart } from "./handlers/session-start.js";
import {
  upsertDecideRouterHooks,
  stripDecideRouterHooks,
  DECIDE_ROUTER_HOOKS,
} from "./install.js";

describe("authorization handlers (fail-open)", () => {
  it("beforeShellExecution denies dangerous shell when policy runs", async () => {
    const result = await beforeShellExecution({
      command: "chmod 777 /tmp/x",
      cwd: process.cwd(),
      session_id: "t-shell",
    });
    expect(result.permission).toBe("deny");
  });

  it("beforeShellExecution fails open on empty benign", async () => {
    const result = await beforeShellExecution({
      command: "ls packages",
      cwd: process.cwd(),
      session_id: "t-ls",
    });
    expect(["allow", "ask"]).toContain(result.permission);
  });

  it("beforeMCPExecution returns a permission", async () => {
    const result = await beforeMCPExecution({
      tool_name: "browser_navigate",
      tool_input: { url: "https://example.com" },
      cwd: process.cwd(),
    });
    expect(["allow", "ask", "deny"]).toContain(result.permission);
  });

  it("preToolUse denies secret-shaped writes", async () => {
    const result = await preToolUse({
      tool_name: "Write",
      tool_input: {
        path: "cfg.json",
        contents: 'api_key: "ghp_abcdefghijklmnopqrstuvwxyz0123"',
      },
      cwd: process.cwd(),
    });
    expect(result.permission).toBe("deny");
  });

  it("stop fails open to continue on quiet session", async () => {
    const result = await stop({ session_id: "quiet", cwd: process.cwd() });
    expect(result.status).toBe("continue");
  });

  it("preCompact fails open to empty-ish result", async () => {
    const result = await preCompact({
      chunks: [{ id: "1", source: "a", preview: "hello" }],
      cwd: process.cwd(),
    });
    expect(result).toBeTypeOf("object");
  });

  it("sessionStart returns additional_context", async () => {
    const result = await sessionStart({ cwd: process.cwd() });
    expect(result.additional_context).toMatch(/Decide-Router/);
  });
});

describe("hooks.json merge", () => {
  it("upserts all authorization events without dropping others", () => {
    const merged = upsertDecideRouterHooks({
      version: 1,
      hooks: {
        preToolUse: [{ command: "./hooks/other.mjs", timeout: 3 }],
      },
    });
    expect(merged.hooks.sessionStart?.length).toBeGreaterThan(0);
    expect(merged.hooks.beforeShellExecution?.length).toBeGreaterThan(0);
    expect(merged.hooks.beforeMCPExecution?.length).toBeGreaterThan(0);
    expect(merged.hooks.preToolUse?.some((e) => e.command.includes("other"))).toBe(
      true,
    );
    expect(
      merged.hooks.preToolUse?.some((e) =>
        e.command.includes("decide-router-pre-tool"),
      ),
    ).toBe(true);
    expect(merged.hooks.stop?.length).toBeGreaterThan(0);
    expect(merged.hooks.preCompact?.length).toBeGreaterThan(0);

    const stripped = stripDecideRouterHooks(merged);
    expect(
      stripped.hooks.preToolUse?.every(
        (e) => !e.command.includes("decide-router-"),
      ),
    ).toBe(true);
  });

  it("declares the required hook events", () => {
    expect(Object.keys(DECIDE_ROUTER_HOOKS).sort()).toEqual(
      [
        "beforeMCPExecution",
        "beforeShellExecution",
        "preCompact",
        "preToolUse",
        "sessionStart",
        "stop",
      ].sort(),
    );
  });
});
