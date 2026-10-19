#!/usr/bin/env node
import { runHook } from "./decide-router-lib.mjs";

await runHook("session-start", {
  additional_context:
    "Decide-Router sessionStart fail-open (handlers unavailable).",
});
