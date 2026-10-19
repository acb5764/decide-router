#!/usr/bin/env node
import { sessionStartBootstrap, loadCursorConfig } from "../runtime.js";
import { readStdinJson, writeResult } from "./read-stdin.js";

const input = await readStdinJson<{ cwd?: string }>();
const cwd = input.cwd ?? process.cwd();
const artifact = await sessionStartBootstrap(cwd);
const cfg = loadCursorConfig(cwd);

writeResult({
  continue: true,
  agentMessage: artifact?.agentInstruction ??
    "Decide-Router: read preference files → bootstrap → load trees before acting.",
  configGoal: cfg.goal,
  trees: artifact?.trees.map((t) => t.id) ?? [],
});
