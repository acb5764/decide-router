#!/usr/bin/env node
import { runHook } from "./decide-router-lib.mjs";

await runHook("before-shell", { permission: "allow" });
