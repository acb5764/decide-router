#!/usr/bin/env node
/**
 * decide-router-cursor — install/uninstall/status for user-global Cursor hooks.
 */

function usage(): never {
  console.log(`decide-router-cursor — wire Decide-Router authorization hooks into Cursor

Hooks (fail open on errors; policy may still deny when evaluated):
  sessionStart, beforeShellExecution, beforeMCPExecution,
  preToolUse, stop, preCompact

Usage:
  decide-router-cursor install
  decide-router-cursor uninstall
  decide-router-cursor status

Env:
  CURSOR_AGENT_HOME       default ~/.cursor
  DECIDE_ROUTER_DATA_DIR  default $CURSOR_AGENT_HOME/decide-router
  DECIDE_ROUTER_ROOT      override handler resolution root
`);
  process.exit(1);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (!cmd || cmd === "-h" || cmd === "--help") usage();

  if (cmd === "install") {
    const { installUserAssets } = await import("./install.js");
    await installUserAssets();
    return;
  }
  if (cmd === "uninstall") {
    const { uninstallUserAssets } = await import("./install.js");
    await uninstallUserAssets();
    return;
  }
  if (cmd === "status") {
    const { statusUserAssets } = await import("./install.js");
    await statusUserAssets();
    return;
  }
  usage();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
