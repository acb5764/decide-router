#!/usr/bin/env node
import { runHook } from "./decide-router-lib.mjs";

await runHook("before-mcp", { permission: "allow" });
